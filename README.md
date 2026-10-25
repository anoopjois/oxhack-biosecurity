# BioSecure

## Viral outbreak early warning

BioSecure is a proof-of-concept dashboard for **identifying rising viral-outbreak risk
and forecasting a risk index 48 hours ahead** across England's 36 NHS Integrated Care
Boards (ICBs). It combines wastewater viral load, A&E waiting-time pressure and a
mobility/crowding index, helping an operator review unusual signals before the
current risk index reaches its critical level.

**The current application uses entirely synthetic telemetry.** It is a statistical
demonstrator, not a live surveillance service, a pathogen-identification system or a
clinically validated outbreak predictor. A score of 80/100 is an index, **not an 80%
probability of an outbreak**. Reports and emails are labelled as exercises.

### What it does

- Maps each ICB as Normal, Elevated, Critical or Insufficient data.
- Shows current risk, a 48-hour forecast, estimated viral doubling time and risk history.
- Explains the three factor weights in the England overview; selecting an area
  shows its readings, baseline comparisons where applicable, and score contributions.
- Creates an incident when the risk forecast is critical **and** wastewater growth
  is statistically positive.
- Requires explicit **Approve & send report** or **Dismiss**. Approval asks Gemini for
  a brief situation assessment, renders a PDF and emails it to the displayed address.
- Names the affected ICB as the intended authority for NHS preparedness review,
  with proposed liaison with UKHSA and local public health.

It does **not** automatically email authorities, diagnose infections, order clinical
interventions, move stock or control rideshare services. Actual delivery uses one
configured address for every area, not a directory of official ICB contacts.

## Documentation

| Guide | Contents |
|---|---|
| [System design and API](docs/SPEC.md) | Architecture, data flow, state, reporting lifecycle, endpoints and coverage |
| [Maths and validation](docs/MATHS.md) | Generator, preprocessing, score, forecast, alert rules, measured results and limitations |
| [Demo checklist](docs/DEMO_CHECKLIST.md) | Safe setup, presentation checks and browser verification |
| [Demo script](docs/DEMO_SCRIPT.md) | A short, evidence-grounded presentation walkthrough |

## Tech stack

| Layer | Technology |
|---|---|
| Dashboard | React 19, TypeScript 6, Vite 8, CSS, custom SVG charts |
| Map | Leaflet/react-leaflet, bundled Natural Earth outline; optional OpenStreetMap tiles |
| Backend | Python, FastAPI, Uvicorn, Pydantic |
| Statistical engine | NumPy and pandas; rolling statistics, logistic weighting and ordinary least squares |
| Storage | SQLite in WAL mode |
| Report generation | Gemini REST API via HTTPX, structured JSON validation, ReportLab PDF |
| Delivery | SMTP with STARTTLS or implicit TLS |
| Development/testing | pytest, pypdf, Vitest, Testing Library, Playwright, Oxlint; optional matplotlib scripts |

The statistical detector is **not machine learning**, and Gemini does not calculate
scores or decide severity. Python dependencies are declared in
[requirements.txt](requirements.txt) and [requirements-dev.txt](requirements-dev.txt);
frontend versions and scripts are in [package.json](frontend/package.json).

## Local setup

Recommended development environment: **Python 3.12** and **Node.js 22.12+ or 24**, with
npm. Commands below assume the repository root. Internet access is needed to install
dependencies; Gemini and email additionally require provider credentials.

### Windows / PowerShell

One-time setup:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Set-Location frontend
npm ci
Set-Location ..
```

Using the development requirements also installs PDF-test and plotting dependencies.
For dashboard-only use, install `requirements.txt` instead.

Start the backend in a terminal at the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000
```

Start the frontend in a second terminal:

```powershell
Set-Location frontend
npm run dev
```

Open **http://localhost:5173/**, or the URL printed by Vite if that port was occupied.
The backend health check is **http://localhost:8000/api/v1/health**; interactive API
documentation is **http://localhost:8000/docs**.

No virtual-environment activation is required when using the explicit Python path.
Do not create another environment or install dependencies inside a nested frontend folder.

### Linux / macOS / WSL

Create a local configuration if one does not already exist, then start the helper:

```bash
test -f .env || cp .env.example .env
./dev.sh
```

The helper creates the root virtual environment, installs runtime dependencies and
starts both servers. It uses `.venv/bin`, so it is **not** a native Windows launcher.
In WSL, use a Linux virtual environment rather than reusing a Windows one.
The helper sources `.env` as shell input: use simple shell-compatible assignments
and quote values containing spaces or shell metacharacters.

### First run

Click **Run demo**. It resets the run, injects growth into Greater Manchester at
`r = 0.4/day`, and advances one simulated day per second. The default run has 28 days
of history plus 14 future days; the clock starts on the final history day and
automatically pauses at the end.

Without Gemini/SMTP credentials, the map, scores, forecasts and incident review
still work. Approving a report with missing configuration produces a visible failure.
Use **Dismiss** when demonstrating without sending.

## Configuration

Copy [.env.example](.env.example) to the **repository-root** `.env`. Never commit or
share that file or your credentials. Do not put provider secrets in frontend code
or `VITE_*` settings.

| Setting | Default / purpose |
|---|---|
| `GEMINI_API_KEY` | Required for approved report generation |
| `GEMINI_MODEL` | `gemini-3.8-flash`; choose a model available to your account |
| `REPORT_TIMEOUT_S` | `600` seconds (10 minutes); used for Gemini HTTP and SMTP timeouts |
| `ALERT_RECIPIENT` | Defaults to the development inbox in the example; one address for all ICBs |
| `SMTP_HOST`, `SMTP_PORT` | `smtp.gmail.com`, `587` |
| `SMTP_SECURITY` | `starttls`; use `ssl` with the provider's implicit-TLS port if required |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | Sender credentials; Gmail needs an app password |
| `SMTP_FROM` | Sender address; if omitted, backend defaults to `SMTP_USERNAME` |
| `BACKEND_PORT`, `FRONTEND_PORT` | `8000`, `5173`; helper/frontend configuration |
| `DB_PATH` | `backend/biosecurity.sqlite3`, relative to the repository root |
| `SIM_SEED`, `SIM_START_DATE` | `42`, `2026-09-01` |
| `CLOCK_SECONDS_PER_DAY` | `2.0`; Run demo explicitly uses `1.0` |

An explicitly blank `SMTP_FROM` in the example must be filled in; it is not the
same as omitting the variable. Plaintext SMTP is not supported.

On native Windows, the manual Uvicorn command's `--port` must match `BACKEND_PORT`;
the environment value does not override an explicit CLI port. Restart Vite after
changing its port or backend-proxy settings.

### Why a saved setting may not appear

The backend reads settings **once at import/startup**. They are not live-synchronised.
Existing process environment variables take precedence over `.env` because
`load_dotenv()` does not overwrite them. VS Code can also inject `.env` values when
creating terminals (`python.terminal.useEnvFile` is enabled locally).

If an old recipient or a 90-second timeout persists:

1. Save the root `.env`.
2. Stop the backend with **Ctrl+C**.
3. Remove stale overrides in that same PowerShell terminal:

   ```powershell
   Remove-Item Env:REPORT_TIMEOUT_S, Env:ALERT_RECIPIENT -ErrorAction SilentlyContinue
   ```

4. Optionally verify the effective timeout without making any network requests:

   ```powershell
   .\.venv\Scripts\python.exe -c "from backend.agent.reporting import DeliverySettings; print(DeliverySettings().timeout_s)"
   ```

5. Restart the backend and create a fresh incident.

`--reload` normally watches Python files, not `.env`. An existing incident retains
the recipient captured when it was opened; refreshing the browser does not rewrite it.
An old failure message also remains a record of that failed attempt.

**Restarting the backend or resetting the run clears demo incidents, events,
decisions and saved PDFs. Download reports you need first.** Restarting is necessary
to reload changed zone metadata; resetting alone does not reload the CSV.

### Gemini or SMTP errors

- A model can appear in metadata yet fail generation. For HTTP 404, choose an
  account-supported `GEMINI_MODEL` and restart.
- The 600-second HTTPX setting controls network timeouts; it is not a promise that
  a PDF will be ready within exactly ten minutes, nor a provider availability guarantee.
- Gmail requires 2-Step Verification and an app password, not your normal password.
- Check the delivery address before approval. Use only an agreed, authorised inbox,
  and do not send synthetic alerts to live public-health teams without permission.
- `sent` means the SMTP server accepted the message, **not** confirmed inbox delivery.
- A definite failure permits explicit retry. If a PDF already exists, retry reuses it.
  **Delivery unconfirmed** disables retry to reduce duplicate-email risk.

## How it works

```text
Seeded telemetry generator (full timeline kept in memory)
    -> ingest one observed day into SQLite
    -> baseline-normalised signals and current risk score
    -> seven-day wastewater growth fit and 48-hour risk forecast
    -> status transition and incident summary
    -> operator approves
    -> Gemini assessment -> validated JSON -> PDF -> SMTP
    -> dashboard report status and download
```

The score weights are **50% wastewater, 35% A&E, 15% mobility**. Critical entry
requires a projected score of at least 80 and `r_hat - 2 * se_r > 0`. Hysteresis
and frozen baselines prevent an ongoing alert from explaining itself away.
See [the complete derivation](docs/MATHS.md).

Gemini receives the **detection-time observed snapshot**, not injected outbreak
ground truth, future telemetry or SMTP credentials. Its narrative is capped at
350 words with three or four proposed actions. The prompt requests an owner,
timeframe and concrete next step for verification, public-health liaison and NHS
readiness. The evidence table is rendered directly from stored measurements.
AI text remains advisory and can be wrong; schema validation is not clinical validation.

Approval authorises generation **and dispatch**, not review of Gemini's final text.
Reset invalidates stale worker updates, but once sending begins a message may still
be submitted. Reset cannot recall an email.

## ICB coverage and validation

[engine/zones.csv](engine/zones.csv) contains England's **36 ICBs effective 1 April
2026**, checked against the [ONS register](https://geoportal.statistics.gov.uk/datasets/integrated-care-boards-april-2026-names-and-codes-in-en/explore).
Runtime counts come from the roster, not a fixed constant. Pins and populations are
approximate demo metadata, not official boundary geometry or population estimates.
See [coverage details](docs/SPEC.md#icb-coverage).

The previously measured 200-seed, 36-ICB validation found:

- Median alert lead of **2 days**, mean **2.245 days**, relative to the current score
  crossing 80; alerts were on or before that crossing in **100%** of seeds.
- **One false CRITICAL zone-day in 165,600 clean zone-days.** The strict
  zero-false-CRITICAL requirement therefore remains failing.

These are synthetic benchmark results, **not clinical prediction accuracy or proof of
lead time before diagnoses**. No thresholds or requirements were weakened to hide
the failure. Full distributions and assumptions are in
[measured results](docs/MATHS.md#8-measured-results).

## Development and tests

From the root, after installing development requirements:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

The full suite includes the known failing clean-data requirement. To print the
statistical benchmark output:

```powershell
.\.venv\Scripts\python.exe -m pytest -s engine\tests\test_required.py
```

Frontend checks:

```powershell
Set-Location frontend
npm test
npm run build
npm run lint
```

Python tests use fake Gemini/SMTP boundaries; frontend unit tests mock dependencies.
They do not send real mail or make paid generation calls.

For mocked browser layout checks, start the frontend, then:

```powershell
Set-Location frontend
$env:PLAYWRIGHT_BASE_URL = 'http://localhost:5173'
npx playwright test responsive.spec.ts --project=chromium-720 --project=webkit-720
```

If Playwright reports missing browsers, install them with
`npx playwright install chromium webkit`. These layout tests mock API traffic and
do not need the backend. The full suite (`npx playwright test`) also exercises the
real demo backend, **resets its state**, and covers six browser/viewport projects;
use a disposable run. On Windows start both servers and set `PLAYWRIGHT_BASE_URL`
explicitly. Automatic startup uses the Unix helper.

For a deliberately paid, manual Gemini-only check that never sends email:

```powershell
.\.venv\Scripts\python.exe scripts\llm_smoke.py --output incident-report.pdf
```

Run that last command from the repository root. Reports/tests create local artifacts;
do not commit generated reports, runtime databases or credentials.

## Repository map

- [engine/](engine/): pure generator, preprocessing, scoring, forecasting and status replay.
- [backend/](backend/): API, simulation clock, SQLite, incidents and report delivery.
- [frontend/](frontend/): dashboard, map, charts, controls and approval UI.
- [scripts/](scripts/): optional plots, growth-rate analysis, map generation and report smoke check.
- [docs/](docs/): current design, maths and presentation guidance. Older screenshots
  in [docs/figures/](docs/figures/) may depict retired UI; they are not the feature specification.

The inventory API and seeded inventory tables remain for compatibility, but the
current workflow never moves stock. Legacy allocation and transfer-map code are removed.

## Deployment boundary

This is a **local, single-process demonstrator**, not a production health service.
It has no authentication/role-based approval, durable job queue, official
recipient routing, clinical calibration or real-data integrations. Do not expose
its mutation endpoints publicly. Use one backend worker: each process owns its own
clock and startup resets the demo database. Production use needs validated data,
security/privacy review, agreed escalation governance and durable delivery auditing.
