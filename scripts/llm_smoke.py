"""Make ONE real Claude call for an agent briefing and print the validated result or why it failed.

    .venv/bin/python scripts/llm_smoke.py            # needs ANTHROPIC_API_KEY in .env or the environment

The context is real: it runs the simulation (seed 42), triggers an outbreak in Greater
Manchester and takes the context of the CRITICAL episode the agent opens. The unit tests mock
the client; this script is the only thing that talks to the API.
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend import config  # noqa: E402
from backend.agent.llm import ClaudeWriter, run_writer  # noqa: E402
from backend.simulation import Simulation  # noqa: E402

ZONE, R = "greater-manchester", 0.4


def sample_context() -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        sim = Simulation(config.Settings(db_path=Path(tmp) / "smoke.sqlite3"), directive_writer=None)
        try:
            sim.trigger_outbreak(ZONE, R)
            while not sim.at_end:
                sim.step()
                row = sim.conn.execute("SELECT context FROM agent_episodes WHERE zip_code = ?",
                                       (ZONE,)).fetchone()
                if row:
                    return json.loads(row["context"])
        finally:
            sim.close()
    raise SystemExit(f"no CRITICAL episode opened for {ZONE}; try another seed")


def main() -> int:
    if not config.ANTHROPIC_API_KEY:
        print("ANTHROPIC_API_KEY is not set (add it to .env). Nothing was sent.")
        return 1
    context = sample_context()
    writer = ClaudeWriter()
    print(f"model={writer.model} effort={config.LLM_EFFORT} timeout={config.LLM_TIMEOUT_S}s "
          f"zone={context['zone']['name']} date={context['date']}")
    outcome = run_writer(writer, context)
    if outcome.status != "done":
        print(f"FAILED: {outcome.status} (the rule-based briefing would stand)")
        return 2
    briefing = outcome.briefing
    print(f"\n{config.SOURCE_LABELS['llm']}: {briefing.headline}\n\n{briefing.rationale}\n")
    for d in briefing.directives:
        print(f"  [{d.priority:>9}] ({d.category}) {d.action}: {d.detail}")
    if outcome.ignored_fields:
        print(f"\nignored fields (never used): {outcome.ignored_fields}")
    print("\nOK: passed schema and number checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
