"""Generate one Gemini PDF from synthetic observed data. Never sends email.

Run manually: .venv\\Scripts\\python scripts\\llm_smoke.py
Requires GEMINI_API_KEY. Output is written only to an explicit --output path.
"""

import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend import config  # noqa: E402
from backend.agent.reporting import ReportError, ReportService  # noqa: E402
from backend.simulation import Simulation  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not config.GEMINI_API_KEY:
        print("Set GEMINI_API_KEY in .env. Nothing was generated or sent.")
        return 1
    with tempfile.TemporaryDirectory() as tmp:
        sim = Simulation(config.Settings(db_path=Path(tmp) / "smoke.sqlite3"))
        try:
            sim.trigger_outbreak("greater-manchester", 0.4)
            while not sim.at_end:
                sim.step()
                row = sim.conn.execute("SELECT context FROM agent_episodes LIMIT 1").fetchone()
                if row:
                    try:
                        pdf = ReportService().generate(json.loads(row["context"]))
                    except ReportError as exc:
                        print(f"Report generation failed: {exc}")
                        return 2
                    args.output.write_bytes(pdf)
                    print(f"Generated {args.output}. No email was sent.")
                    return 0
        finally:
            sim.close()
    print("No critical incident was detected.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
