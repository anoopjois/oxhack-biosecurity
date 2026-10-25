"""The optional LLM briefing (Claude). Runs after the tick, never sets quantities.

The request uses structured outputs (a JSON schema with no quantity fields), server-side
refusal fallbacks, and a timeout. Whatever comes back is validated exactly like the
template (backend/agent/briefing.py); on any failure the rule-based briefing stands.
"""

import json
from dataclasses import dataclass, field
from typing import Protocol

import anthropic

from backend import config
from backend.agent.briefing import Briefing, BriefingRejected, validate_briefing

SYSTEM_PROMPT = """\
You write the incident briefing for an automated public-health logistics system (the \
"autobalancer") that monitors England's Integrated Care Boards. This is a hackathon \
simulation and all data is synthetic.

When a zone's outbreak risk turns CRITICAL, the system has already, deterministically:
1. computed a move of PPE, antiviral and vaccine stock to the zone from the nearest safe \
supply hubs. If `approval.required` is true the move is proposed: it happens once an operator \
approves, or automatically if nobody objects within `approval.timeout_s` seconds. Otherwise \
it has already happened. Each donor keeps `reserve_days_after` days of normal use, never \
below `reserve_floor_days`; and
2. disabled pooled rideshare in the zone through a platform webhook.
You receive those facts as JSON. Your job is only to explain and to advise.

Write for an NHS regional incident commander reading a live dashboard: plain English, \
specific and calm.

Rules:
- All quantities are final. Never propose, change or invent a quantity, date or statistic. \
Mention a number only if it appears in the input, written the same way (thousands \
separators are fine).
- Headline: one line, at most 140 characters.
- Rationale: 3 to 5 sentences. Say why the zone is critical (projected score, growth rate \
and its standard error, doubling time, ER waits against baseline, and the lag from \
wastewater to hospital demand), then what stock is moving, how much of the shortfall it \
covers and that the donors keep a safe reserve.
- Directives: 1 to 6 non-pharmaceutical containment actions or guidance on using the \
incoming stock, most urgent first. The rideshare suspension has already been executed; you \
may list it as an action taken.
"""

DIRECTIVE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["headline", "rationale", "directives"],
    "properties": {
        "headline": {"type": "string"},
        "rationale": {"type": "string"},
        "directives": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["action", "detail", "priority", "category"],
                "properties": {
                    "action": {"type": "string"},
                    "detail": {"type": "string"},
                    "priority": {"type": "string", "enum": ["immediate", "24h", "72h"]},
                    "category": {"type": "string", "enum": ["mobility", "healthcare", "supply",
                                                            "surveillance", "communication"]},
                },
            },
        },
    },
}


class LLMRefused(Exception):
    """The model (and its fallback) declined: stop_reason == "refusal"."""


class DirectiveWriter(Protocol):
    model: str

    def write(self, context: dict) -> dict:
        """Return the raw JSON object for the briefing (validated by the caller)."""


@dataclass(frozen=True)
class LLMOutcome:
    status: str                        # done | refused | failed:<why> | rejected:<why>
    briefing: Briefing | None = None
    ignored_fields: list[str] = field(default_factory=list)
    model: str | None = None


class ClaudeWriter:
    def __init__(self, client: anthropic.Anthropic | None = None, model: str = config.LLM_MODEL):
        self.client = client or anthropic.Anthropic(
            api_key=config.ANTHROPIC_API_KEY, timeout=config.LLM_TIMEOUT_S,
            max_retries=config.LLM_MAX_RETRIES)
        self.model = model

    def request_kwargs(self, context: dict) -> dict:
        return {
            "model": self.model,
            "max_tokens": config.LLM_MAX_TOKENS,
            "betas": [config.LLM_FALLBACK_BETA],
            "fallbacks": "default",  # a safety-classifier decline is retried on the recommended model
            "output_config": {"effort": config.LLM_EFFORT,
                              "format": {"type": "json_schema", "schema": DIRECTIVE_SCHEMA}},
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": json.dumps(context, sort_keys=True)}],
        }

    def write(self, context: dict) -> dict:
        response = self.client.beta.messages.create(**self.request_kwargs(context))
        if response.stop_reason == "refusal":
            raise LLMRefused()
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise BriefingRejected("invalid_json", f"no text block (stop_reason {response.stop_reason})")
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise BriefingRejected("invalid_json", str(exc)) from exc


def run_writer(writer: DirectiveWriter, context: dict) -> LLMOutcome:
    """Call the writer and validate its output; every failure becomes a status string."""
    model = getattr(writer, "model", None)
    try:
        raw = writer.write(context)
        briefing, ignored = validate_briefing(raw, context)
        return LLMOutcome("done", briefing, ignored, model)
    except BriefingRejected as exc:
        return LLMOutcome(f"rejected:{exc.reason}", model=model)
    except LLMRefused:
        return LLMOutcome("refused", model=model)
    except (anthropic.APITimeoutError, TimeoutError):
        return LLMOutcome("failed:timeout", model=model)
    except anthropic.APIConnectionError:
        return LLMOutcome("failed:connection", model=model)
    except anthropic.APIStatusError as exc:
        return LLMOutcome(f"failed:http_{exc.status_code}", model=model)
    except Exception as exc:  # never let a briefing failure escape into the simulation
        return LLMOutcome(f"failed:{type(exc).__name__}", model=model)


def make_writer() -> ClaudeWriter | None:
    """A Claude writer if an API key is configured, otherwise None (rule-based briefings only)."""
    return ClaudeWriter() if config.ANTHROPIC_API_KEY else None
