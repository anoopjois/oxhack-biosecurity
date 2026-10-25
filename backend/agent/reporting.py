"""Gemini assessment, professional PDF rendering and SMTP delivery after approval."""

from dataclasses import dataclass
from email.headerregistry import Address
from email.message import EmailMessage
from email.utils import make_msgid
from io import BytesIO
import json
import logging
import smtplib
import ssl
from typing import Annotated
from xml.sax.saxutils import escape

import httpx
from pydantic import BaseModel, ConfigDict, Field
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from backend import config

logger = logging.getLogger(__name__)
Text = Annotated[str, Field(min_length=1, max_length=config.REPORT_TEXT_MAX_CHARS)]


class Assessment(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    executive_summary: Text
    assessment: Text
    recommended_actions: list[Text] = Field(
        min_length=config.REPORT_ACTIONS_RANGE[0], max_length=config.REPORT_ACTIONS_RANGE[1])
    limitations: Text


class ReportError(Exception):
    """A safe, operator-facing failure (never includes provider responses or credentials)."""


class DeliveryUnknown(ReportError):
    """The SMTP server may have accepted the email; do not retry automatically."""


@dataclass(frozen=True)
class DeliverySettings:
    api_key: str = config.GEMINI_API_KEY
    model: str = config.GEMINI_MODEL
    recipient: str = config.ALERT_RECIPIENT
    smtp_host: str = config.SMTP_HOST
    smtp_port: int = config.SMTP_PORT
    smtp_username: str = config.SMTP_USERNAME
    smtp_password: str = config.SMTP_PASSWORD
    smtp_from: str = config.SMTP_FROM
    smtp_security: str = config.SMTP_SECURITY
    timeout_s: float = config.REPORT_TIMEOUT_S


def metric(value, suffix: str = "") -> str:
    return "Not available" if value is None else f"{value:,.2f}{suffix}"


def render_pdf(context: dict, assessment: Assessment, model: str) -> bytes:
    """Keep observed measurements separate from Gemini's interpretive text."""
    output = BytesIO()
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(output, pagesize=A4, rightMargin=20 * mm, leftMargin=20 * mm,
                            topMargin=22 * mm, bottomMargin=22 * mm,
                            title="BioSecure - Synthetic Incident Report", author="BioSecure")

    def paragraph(text: str, style: str = "BodyText") -> Paragraph:
        return Paragraph(escape(text).replace("\n", "<br/>"), styles[style])

    zone, observed = context["zone"], context["observed"]
    story = [
        paragraph("BioSecure | Incident Report", "Title"),
        paragraph(config.SYNTHETIC_NOTICE, "Heading3"),
        paragraph(f"{zone['name']} | Detection date: {context['detected_date']}"),
        paragraph(f"Incident {context['episode_id']} | Recipient: {context['recipient']}"),
        Spacer(1, 6 * mm),
        paragraph("Executive summary", "Heading2"),
        paragraph(assessment.executive_summary),
        paragraph("Observed evidence at detection", "Heading2"),
    ]
    rows = [
        ["Indicator", "Observed value"],
        ["Status", "CRITICAL"],
        ["Current risk (0-100)", metric(observed["score"])],
        ["Forecast risk in 48 hours (0-100)", metric(observed["projected_score"])],
        ["Wastewater doubling time", metric(observed["doubling_days"], " days")],
        ["Growth rate / day", metric(observed["r_hat"])],
        ["Growth rate standard error", metric(observed["se_r"])],
        ["A&E average wait", metric(observed["telemetry"]["er_avg_wait_mins"], " minutes")],
        ["A&E baseline wait", metric(observed["er_baseline"], " minutes")],
        ["Wastewater copies / litre", metric(observed["telemetry"]["wastewater_copies_per_l"])],
        ["Approximate population", f"{zone['population']:,}"],
    ]
    table = Table([[paragraph(cell) for cell in row] for row in rows],
                  colWidths=[100 * mm, 65 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e9f1fb")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.lightgrey),
    ]))
    story.extend([table, paragraph("AI-assisted assessment", "Heading2"),
                  paragraph(assessment.assessment),
                  paragraph("Recommended actions for authority review", "Heading2")])
    for index, action in enumerate(assessment.recommended_actions, 1):
        story.append(paragraph(f"{index}. {action}"))
    story.extend([
        paragraph("Limitations", "Heading2"), paragraph(assessment.limitations),
        paragraph("All telemetry is synthetic. This statistical alert does not identify a pathogen "
                  "or establish a diagnosis. Recommendations are advisory; no stock transfers or "
                  "containment actions have been executed."),
        paragraph(f"AI model: {model}. An operator approved report generation and email dispatch, "
                  "not the subsequently generated AI wording."),
    ])

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.drawString(20 * mm, 12 * mm, "SYNTHETIC EXERCISE | BioSecure")
        canvas.drawRightString(190 * mm, 12 * mm, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()


class ReportService:
    def __init__(self, settings: DeliverySettings | None = None):
        self.settings = settings or DeliverySettings()

    def validate_configuration(self) -> None:
        s = self.settings
        missing = [name for name, value in (
            ("GEMINI_API_KEY", s.api_key), ("SMTP_HOST", s.smtp_host),
            ("SMTP_USERNAME", s.smtp_username), ("SMTP_PASSWORD", s.smtp_password),
            ("SMTP_FROM", s.smtp_from), ("ALERT_RECIPIENT", s.recipient)) if not value.strip()]
        if missing:
            raise ReportError(f"Configure {', '.join(missing)} in .env before sending.")
        if s.smtp_security not in {"starttls", "ssl"}:
            raise ReportError("SMTP_SECURITY must be starttls or ssl.")
        if not 0 < s.smtp_port <= 65535 or s.timeout_s <= 0:
            raise ReportError("SMTP_PORT and REPORT_TIMEOUT_S must be positive and valid.")
        for address in (s.smtp_from, s.recipient):
            try:
                parsed = Address(addr_spec=address)
            except ValueError:
                raise ReportError("SMTP_FROM and ALERT_RECIPIENT must be valid single email addresses.") from None
            if not parsed.username or not parsed.domain:
                raise ReportError("SMTP_FROM and ALERT_RECIPIENT must be valid single email addresses.")

    def generate(self, context: dict) -> bytes:
        s = self.settings
        schema = Assessment.model_json_schema()
        prompt = (
            "Write a professional public-health exercise incident report using only the supplied "
            "observed context. All data is synthetic. Clearly distinguish measurements from "
            "interpretations. Do not invent facts, identify a pathogen, claim actions were executed, "
            "or recommend stock transfers or rideshare restrictions. Suggest verification and "
            "authority review rather than issuing medical or containment orders. Do not add numeric "
            "claims to the narrative; exact measurements are rendered separately in a verified table. "
            "State uncertainty and the synthetic nature of the exercise in the limitations."
        )
        try:
            response = httpx.post(
                f"{config.GEMINI_API_URL}/{s.model}:generateContent",
                headers={"x-goog-api-key": s.api_key},
                json={"systemInstruction": {"parts": [{"text": prompt}]},
                      "contents": [{"role": "user", "parts": [{"text": json.dumps(context)}]}],
                      "generationConfig": {"responseMimeType": "application/json",
                                           "responseJsonSchema": schema,
                                           "maxOutputTokens": config.REPORT_MAX_TOKENS}},
                timeout=s.timeout_s)
            response.raise_for_status()
            candidate = response.json()["candidates"][0]
            if candidate.get("finishReason") != "STOP":
                raise ReportError("Gemini did not return a complete report. Retry generation.")
            assessment = Assessment.model_validate_json(
                "".join(part.get("text", "") for part in candidate["content"]["parts"]
                        if not part.get("thought")))
        except httpx.HTTPStatusError as exc:
            raise ReportError(f"Gemini request failed (HTTP {exc.response.status_code}).") from None
        except httpx.RequestError:
            raise ReportError("Gemini could not be reached. Check the connection and retry.") from None
        except (KeyError, IndexError, TypeError, ValueError):
            raise ReportError("Gemini returned an invalid incident report. Retry generation.") from None
        return render_pdf(context, assessment, s.model)

    def send(self, context: dict, pdf: bytes) -> None:
        s = self.settings
        message = EmailMessage()
        message["Subject"] = f"[SIMULATED EXERCISE] BioSecure incident - {context['zone']['name']}"
        message["From"], message["To"] = s.smtp_from, context["recipient"]
        message["Message-ID"] = make_msgid()
        message.set_content(
            f"{config.SYNTHETIC_NOTICE}\n\n"
            f"An operator approved this incident notification for {context['zone']['name']}.\n"
            "The attached PDF contains synthetic evidence and an AI-assisted assessment for review.\n"
            "This is a test notification, not a real emergency. No operational actions were executed.")
        message.add_attachment(pdf, maintype="application", subtype="pdf",
                               filename=f"biosecure-incident-{context['episode_id']}.pdf")
        submitting = False
        try:
            tls = ssl.create_default_context()
            client = (smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=s.timeout_s, context=tls)
                      if s.smtp_security == "ssl" else
                      smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=s.timeout_s))
            try:
                if s.smtp_security == "starttls":
                    client.starttls(context=tls)
                client.login(s.smtp_username, s.smtp_password)
                submitting = True
                client.send_message(message)
            finally:
                # A failed QUIT must not turn a successfully accepted message into a failed send.
                client.close()
        except (smtplib.SMTPResponseException, smtplib.SMTPRecipientsRefused) as exc:
            logger.warning("SMTP rejected report (%s)", type(exc).__name__)
            raise ReportError("SMTP rejected the email. Check sender credentials and recipient.") from None
        except (smtplib.SMTPException, OSError):
            if submitting:
                raise DeliveryUnknown(
                    "Email delivery is unconfirmed: the SMTP server may have accepted it. "
                    "Check the recipient inbox or mail-server logs before sending another report.") from None
            raise ReportError("Could not connect or authenticate to SMTP. Check .env and retry.") from None
