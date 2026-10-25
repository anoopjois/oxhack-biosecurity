"""Gemini REST and SMTP boundaries are mocked: these tests never contact providers."""

from dataclasses import replace
from io import BytesIO
import json
import smtplib
from unittest.mock import MagicMock

import httpx
import pytest
from pypdf import PdfReader

from backend.agent import reporting
from backend.agent.reporting import DeliverySettings, DeliveryUnknown, ReportError, ReportService, render_pdf
from backend.tests.agent_helpers import ASSESSMENT, OUTBREAK_ZONE, step_until_episode


@pytest.fixture
def context(make_sim):
    sim = make_sim()
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    return json.loads(step_until_episode(sim)["context"])


def settings():
    return DeliverySettings(api_key="secret-key", model="gemini-3.8-flash",
                            smtp_username="sender@example.com", smtp_password="app-password",
                            smtp_from="sender@example.com", recipient="test@example.com")


def response(text, finish="STOP"):
    request = httpx.Request("POST", "https://example.com/gemini")
    return httpx.Response(200, request=request, json={"candidates": [
        {"finishReason": finish, "content": {"parts": [{"text": text}]}}]})


def test_gemini_structured_request_and_professional_pdf(context, monkeypatch):
    post = MagicMock(return_value=response(ASSESSMENT.model_dump_json()))
    monkeypatch.setattr(reporting.httpx, "post", post)
    pdf = ReportService(settings()).generate(context)
    kwargs = post.call_args.kwargs
    assert kwargs["headers"] == {"x-goog-api-key": "secret-key"}
    assert kwargs["json"]["generationConfig"]["responseMimeType"] == "application/json"
    assert "responseJsonSchema" in kwargs["json"]["generationConfig"]
    submitted = json.loads(kwargs["json"]["contents"][0]["parts"][0]["text"])
    assert submitted == context and submitted["synthetic"]
    assert "secret-key" not in post.call_args.args[0]
    text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)
    assert "SIMULATED DATA" in text and "gemini-3.8-flash" in text


@pytest.mark.parametrize("result", [
    response("not json"), response("{}"), response(ASSESSMENT.model_dump_json(), "MAX_TOKENS"),
    httpx.Response(200, request=httpx.Request("POST", "https://example.com"), json={}),
    httpx.Response(429, request=httpx.Request("POST", "https://example.com")),
])
def test_invalid_or_failed_gemini_never_becomes_success(context, monkeypatch, result):
    monkeypatch.setattr(reporting.httpx, "post", MagicMock(return_value=result))
    with pytest.raises(ReportError):
        ReportService(settings()).generate(context)


def test_gemini_network_failure(context, monkeypatch):
    monkeypatch.setattr(reporting.httpx, "post", MagicMock(side_effect=httpx.ConnectError("secret-key")))
    with pytest.raises(ReportError, match="could not be reached") as error:
        ReportService(settings()).generate(context)
    assert "secret-key" not in str(error.value)

@pytest.mark.parametrize("failure", [httpx.ConnectTimeout, httpx.ReadTimeout])
def test_gemini_timeouts_explain_the_configured_limit(context, monkeypatch, failure):
    monkeypatch.setattr(reporting.httpx, "post", MagicMock(side_effect=failure("secret-key")))
    with pytest.raises(ReportError, match="timed out after 90 seconds") as error:
        ReportService(replace(settings(), timeout_s=90)).generate(context)
    assert "REPORT_TIMEOUT_S" in str(error.value)
    assert "secret-key" not in str(error.value)

def test_retired_model_404_explains_configuration_fix_without_leaking_provider_body(context, monkeypatch):
    result = httpx.Response(
        404, request=httpx.Request("POST", "https://example.com"),
        json={"error": {"status": "NOT_FOUND", "message": "retired model; secret-key"}})
    monkeypatch.setattr(reporting.httpx, "post", MagicMock(return_value=result))
    service = ReportService(replace(settings(), model="gemini-2.5-flash"))
    with pytest.raises(ReportError) as error:
        service.generate(context)
    message = str(error.value)
    assert "HTTP 404" in message and "gemini-2.5-flash" in message
    assert "GEMINI_MODEL" in message and "restart the backend" in message
    assert "gemini-3.8-flash" in message and "secret-key" not in message


def test_configuration_errors_are_actionable():
    with pytest.raises(ReportError, match="GEMINI_API_KEY"):
        ReportService(replace(settings(), api_key="")).validate_configuration()
    with pytest.raises(ReportError, match="SMTP_PASSWORD"):
        ReportService(replace(settings(), smtp_password="")).validate_configuration()
    with pytest.raises(ReportError, match="SMTP_SECURITY"):
        ReportService(replace(settings(), smtp_security="none")).validate_configuration()
    ReportService(settings()).validate_configuration()

@pytest.mark.parametrize("address", ["first@example.com,second@example.com", "not-an-email", "x@example.com\r\nBcc: y@example.com"])
def test_only_one_valid_recipient_is_accepted(address):
    with pytest.raises(ReportError, match="single email"):
        ReportService(replace(settings(), recipient=address)).validate_configuration()


@pytest.mark.parametrize("security", ["starttls", "ssl"])
def test_smtp_sends_one_synthetic_email_with_real_pdf(context, monkeypatch, security):
    smtp = MagicMock()
    factory = MagicMock(return_value=smtp)
    monkeypatch.setattr(reporting.smtplib, "SMTP_SSL" if security == "ssl" else "SMTP", factory)
    service = ReportService(replace(settings(), smtp_security=security))
    pdf = render_pdf(context, ASSESSMENT, service.settings.model)
    service.send(context, pdf)
    smtp.send_message.assert_called_once()
    message = smtp.send_message.call_args.args[0]
    assert str(message["To"]) == context["recipient"]
    assert "[SIMULATED EXERCISE]" in message["Subject"]
    assert "SIMULATED DATA" in message.get_body().get_content()
    [attachment] = list(message.iter_attachments())
    assert attachment.get_content_type() == "application/pdf"
    assert attachment.get_payload(decode=True) == pdf
    smtp.close.assert_called_once()
    if security == "starttls":
        smtp.starttls.assert_called_once()


@pytest.mark.parametrize("failure, expected", [
    (smtplib.SMTPAuthenticationError(535, b"password-secret"), ReportError),
    (smtplib.SMTPRecipientsRefused({"x": (550, b"rejected")}), ReportError),
    (TimeoutError("network-secret"), DeliveryUnknown),
])
def test_smtp_error_classification_and_secret_redaction(context, monkeypatch, failure, expected):
    smtp = MagicMock()
    smtp.send_message.side_effect = failure
    monkeypatch.setattr(reporting.smtplib, "SMTP", MagicMock(return_value=smtp))
    with pytest.raises(expected) as error:
        ReportService(settings()).send(context, b"%PDF-test")
    assert "secret" not in str(error.value)


def test_pdf_escapes_ai_markup_and_paginates(context):
    long = ASSESSMENT.model_copy(update={"assessment": "<b>Literal & safe</b> " * 180})
    pdf = render_pdf(context, long, "test")
    reader = PdfReader(BytesIO(pdf))
    assert len(reader.pages) > 1
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "<b>Literal & safe</b>" in text
    assert all("SYNTHETIC EXERCISE" in page.extract_text() for page in reader.pages)
