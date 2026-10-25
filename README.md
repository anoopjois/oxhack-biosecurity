# BioSecure: early warning and approved incident reporting

This hackathon demo monitors synthetic wastewater and A&E telemetry across England's
36 ICBs (the April 2026 structure), forecasts risk 48 hours ahead, and opens an incident when the forecast is critical
and growth is statistically significant.

**All data is synthetic. Reports and emails are prominently labelled as exercises.**

The incident card shows a short evidence-based summary. An operator can **Approve &
send report** or **Dismiss**. Approval calls Gemini to write an assessment, renders a
professional PDF, and emails it using SMTP. There is no auto-approval, stock transfer,
rideshare action or separate briefing. Pending approvals and report delivery do not
stop the simulation clock. Synthetic injection remains a demo control and chart marker,
but no longer appears as a hidden step in incident cards.

## ICB coverage

[engine/zones.csv](engine/zones.csv) follows the 36 ICBs effective **1 April 2026**,
verified against the [ONS names and codes register](https://geoportal.statistics.gov.uk/datasets/integrated-care-boards-april-2026-names-and-codes-in-en/explore).
Names omit the common "NHS" prefix and "Integrated Care Board" suffix for display.

| Current ICB | Former areas incorporated |
|---|---|
| Central East | Bedfordshire, Luton and Milton Keynes; Cambridgeshire and Peterborough; Hertfordshire, excluding West Essex |
| Essex | Mid and South Essex; West Essex; North East Essex |
| Norfolk and Suffolk | Norfolk and Waveney; Suffolk, excluding North East Essex |
| West and North London | North West London; North Central London |
| Thames Valley | Buckinghamshire, Oxfordshire and Berkshire West; East Berkshire from Frimley |
| Surrey and Sussex | Surrey Heartlands; Sussex; Surrey areas from Frimley |

Hampshire and Isle of Wight also gains the Hampshire areas of former Frimley.
See the [NHS ODS merger summary](https://digital.nhs.uk/services/organisation-data-service/upcoming-code-changes/icb-mergers-2026-change-summary)
for the organisational changes.

Coordinates are representative map pins, not boundary polygons. Populations remain
rounded **demo sizing estimates**, not official 2026 population statistics. Essex
and Frimley estimates are apportioned between their successors rather than counted
twice; the previous demo's total population is preserved.

The backend, map, inventory and reports all read this shared roster; runtime zone
counts are never fixed in code. Restart the backend after changing the roster:
startup reloads it into SQLite and resets existing demo incidents and reports.
Changing the number/order of zones changes seeded noise samples, so old recorded
demo timings and 42-zone validation figures are not guarantees for the current run.

**Known validation failure (36-ICB roster):** the unchanged detector produced
**1 CRITICAL zone-day in 165,600 clean zone-days** across 200 seeds, so the required
zero-false-CRITICAL test currently fails. The other 96 engine/backend tests pass.
Lead-time requirements still pass: median 2 days and detection on or before the
current-score crossing in 100% of seeds. This limitation is retained explicitly;
the scoring thresholds, generator constants and test requirement were not relaxed.
See [measured results](docs/MATHS.md#8-measured-results) for the distributions.

## Run on Windows

Recommended prerequisites: Python 3.13 and Node 24 with npm.

From the repository root in PowerShell:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env  # first setup only; do not overwrite existing credentials
Set-Location frontend
npm install
```

Start the backend from the repository root in one terminal:

```powershell
.\.venv\Scripts\python -m uvicorn backend.main:app --reload --port 8000
```

Start the frontend in a second terminal:

```powershell
Set-Location frontend
npm run dev -- --strictPort
```

Open http://localhost:5173 and click **Run demo**. The health check is
http://localhost:8000/api/v1/health; API documentation is at http://localhost:8000/docs.

On Linux/macOS or in WSL, `./dev.sh` creates the virtual environment, installs
dependencies and starts both servers. Its `.venv/bin` paths are not compatible with
a native Windows virtual environment.

## Configure Gemini and email

Edit your local `.env` before starting the backend. Never commit or paste credentials.

```dotenv
GEMINI_API_KEY=your-google-ai-studio-api-key
GEMINI_MODEL=gemini-3.8-flash
REPORT_TIMEOUT_S=90
ALERT_RECIPIENT=daeyad1@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_USERNAME=your-sending-account@gmail.com
SMTP_PASSWORD=your-gmail-app-password
SMTP_FROM=your-sending-account@gmail.com
```

For Gmail, enable 2-Step Verification and create an **app password**; do not use your
ordinary Google account password. Other SMTP providers work with their host,
credentials and sender address. Use `SMTP_SECURITY=ssl` and the provider's TLS port
(usually 465) for implicit TLS; plaintext SMTP is not supported.

The recipient defaults to **daeyad1@gmail.com**, a test inbox, not an official authority.
`ALERT_RECIPIENT` is one configured address for all zones; jurisdiction-based authority
routing is not implemented. Change it only when an authorised recipient is agreed.
Use a model available to your Gemini API key; `GEMINI_MODEL` is configurable.
Gemini can list retired models in metadata while rejecting generation for new users.
If generation returns HTTP 404, use a currently supported model and restart the backend;
`gemini-3.8-flash` replaces the older `gemini-2.5-flash` default.
Report generation may take tens of seconds; the default request timeout is 90 seconds.
Increase `REPORT_TIMEOUT_S` and restart if generation repeatedly times out. Reports
run in the background, so waiting does not block the simulation clock.

Missing credentials do not prevent the dashboard running. Approved report jobs then
fail visibly with a configuration message; they never pretend an email was sent.
Settings load at process startup, so configure them before the demo.

### What approval does

1. Stores an explicit operator decision; repeat approval returns HTTP 409.
2. Queues report generation on a background thread.
3. Sends only the detection-time observed snapshot to Gemini, never future telemetry,
   injected outbreak ground truth or secrets.
4. Validates structured JSON and builds a paginated PDF with an executive summary,
   verified evidence table, AI assessment, recommendations and limitations.
5. Stores the PDF in SQLite and attaches it to the synthetic-exercise email.

The UI shows queued, generating, sending, accepted, failed or unconfirmed delivery.
Generated PDFs are downloadable even if SMTP rejects the message. Definite failures
have an operator retry button; a saved PDF is reused rather than regenerating.
If the connection breaks during SMTP submission, delivery is **unconfirmed**, and retry
is disabled to avoid duplicates. Check the recipient inbox or mail-server logs.
SMTP acceptance is not proof of inbox delivery.

Approval authorises generation and dispatch, not a preview of Gemini's eventual text.
AI prose is advisory and may be inaccurate; measurements are rendered separately from
the stored observed data. No stock or containment actions are executed.

### Reset and persistence

A reset invalidates queued/in-progress generation from the old run before SMTP dispatch.
An email already being submitted cannot be recalled. PDF/status records survive browser
reloads, but the demo deliberately resets its simulation database on backend startup
and on **Reset**. Download reports you want to retain. The schema version is bumped for
the report workflow; older demo databases are rebuilt automatically.

Replaying the simulation action log never calls Gemini or sends email. Asynchronous
`REPORT_STATUS` events are excluded from deterministic replay comparisons.

This is a **local demo**, with no production authentication, authority routing, durable
mail queue or clinical validation. Do not expose it publicly or use real health data.

## Validation

```powershell
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python -m pytest backend\tests
.\.venv\Scripts\python -m pytest engine\tests
Set-Location frontend
npm test
npm run lint
npm run build
```

Tests inject fake report services or mock Gemini/SMTP: **no real emails or paid API
calls**. PDF tests parse generated documents, not just mocked filenames.

For a manual, paid Gemini-only smoke check (no email is ever sent):

```powershell
.\.venv\Scripts\python scripts\llm_smoke.py --output incident-report.pdf
```

With backend and frontend already running, `npx playwright test` in `frontend` tests
Chromium and WebKit at three viewport sizes. The e2e suite dismisses notifications;
it never approves real email. Screenshot output uses `SHOTS` or the default
`frontend/e2e/screenshots`. Automatic server startup uses the Unix `dev.sh`; on Windows,
start both servers manually first.

## Architecture and docs

- `engine/`: seeded generator and pure statistical preprocessing/scoring/forecasting.
- `backend/simulation.py`: observed-only ingestion, clock, transitions and operator decisions.
- `backend/agent/executor.py`: incident creation and background report lifecycle.
- `backend/agent/reporting.py`: Gemini structured output, ReportLab PDF and SMTP.
- `frontend/`: React + TypeScript map, charts, incident summaries and notification approval.
- The inventory API and pure allocation utilities remain for reference; incidents no
  longer invoke them or mutate stock.

See [the maths](docs/MATHS.md), [demo checklist](docs/DEMO_CHECKLIST.md) and
[talk track](docs/DEMO_SCRIPT.md). [The original spec](docs/SPEC.md) and earlier phase
briefs describe historical stock/Claude/rideshare behaviour; this reporting workflow
replaces that incident-response phase.
