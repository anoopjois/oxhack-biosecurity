"""The briefing (headline, rationale, directives) and its validation.

Both the rule-based template and the LLM produce the same shape, and both must pass:
  1. the schema (lengths, 1-6 directives, known priorities and categories);
  2. the number check: every integer >= NUMBER_CHECK_MIN in the text must appear in the
     context. The text may only repeat quantities the allocation computed, never invent them.
Unknown fields (e.g. an LLM adding "ppe_units") are dropped and reported, never read.
"""

import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend import config

Priority = Literal["immediate", "24h", "72h"]
Category = Literal["mobility", "healthcare", "supply", "surveillance", "communication"]


class Directive(BaseModel):
    model_config = ConfigDict(extra="ignore")
    action: str = Field(min_length=1)
    detail: str
    priority: Priority
    category: Category


class Briefing(BaseModel):
    model_config = ConfigDict(extra="ignore")
    headline: str = Field(min_length=1, max_length=config.HEADLINE_MAX_CHARS)
    rationale: str = Field(min_length=1, max_length=config.RATIONALE_MAX_CHARS)
    directives: list[Directive] = Field(min_length=config.DIRECTIVES_RANGE[0],
                                        max_length=config.DIRECTIVES_RANGE[1])


class BriefingRejected(Exception):
    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason


NUMBER_TOKEN = re.compile(r"\d[\d,]*(?:\.\d+)?")


def allowed_numbers(context: dict) -> set[int]:
    """Every run of digits in the context (so 82.7 allows 82 and 7, 2026-10-02 allows 2026)."""
    return {int(m) for m in re.findall(r"\d+", json.dumps(context))}


def unsupported_numbers(briefing: Briefing, context: dict) -> list[int]:
    """Integers >= NUMBER_CHECK_MIN in the text that do not appear in the context."""
    allowed = allowed_numbers(context)
    texts = [briefing.headline, briefing.rationale]
    texts += [part for d in briefing.directives for part in (d.action, d.detail)]
    found = []
    for text in texts:
        for token in NUMBER_TOKEN.findall(text):
            digits = token.replace(",", "").split(".")[0]
            if digits and int(digits) >= config.NUMBER_CHECK_MIN and int(digits) not in allowed:
                found.append(int(digits))
    return found


def ignored_fields(raw: dict) -> list[str]:
    """Keys the schema doesn't know, e.g. quantities an LLM tried to add."""
    ignored = [k for k in raw if k not in Briefing.model_fields]
    for i, item in enumerate(raw.get("directives") or []):
        if isinstance(item, dict):
            ignored += [f"directives[{i}].{k}" for k in item if k not in Directive.model_fields]
    return ignored


def validate_briefing(raw: dict, context: dict) -> tuple[Briefing, list[str]]:
    """Return the validated briefing and the list of ignored fields, or raise BriefingRejected."""
    if not isinstance(raw, dict):
        raise BriefingRejected("schema", "not a JSON object")
    try:
        briefing = Briefing.model_validate(raw)
    except ValidationError as exc:
        raise BriefingRejected("schema", str(exc.errors()[0]["msg"])) from exc
    bad = unsupported_numbers(briefing, context)
    if bad:
        raise BriefingRejected("unsupported_number", ", ".join(str(n) for n in bad))
    return briefing, ignored_fields(raw)
