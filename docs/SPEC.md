# BioSecure: current system design and API

This is the specification of the **implemented viral-outbreak early-warning and
approved-reporting system**. It replaces the original logistics/autobalancer pitch.
The original proposal remains in Git history, not as the current product contract.

See [setup and stack](../README.md) and [maths and validation](MATHS.md).

## Purpose and boundaries

BioSecure combines three area-level signals to identify unusual conditions and
project a risk index 48 hours ahead. Its users can inspect evidence, review a critical
incident and explicitly approve a situation report for the affected ICB.

All telemetry is synthetic. There is no live NHS, wastewater-laboratory, mobile-network
or hospital-system integration. An alert is a statistical early warning, not a
confirmed outbreak, pathogen identification, infection probability or clinical order.
The application does not automatically notify authorities or execute containment.

## Problem and intended users

### The problem being explored

Regional preparedness requires more than a high reading: teams need to know what
changed, how unusual it is, whether it is still rising and who should verify it.
Signals may describe different populations, arrive at different times or reflect
non-infectious causes. A&E waits, in particular, are not a pathogen-specific signal.
Combining feeds without those qualifications can create confidence rather than insight.

BioSecure explores a shorter **signal-to-review-to-handoff** workflow:

1. Compare daily observations with the area's recent baseline.
2. Show a transparent current index and a short-horizon projection.
3. Surface a critical incident with the supporting measurements.
4. Let a person dismiss it or approve a concise PDF assessment and email handoff.

The intended outcome is earlier, better-informed preparedness review, not automated
outbreak confirmation. The measured lead in this repository is relative to a synthetic
index crossing, not a demonstrated advantage over clinical surveillance.

### Intended users and potential clients

| Audience | Proposed use | Decision boundary |
|---|---|---|
| ICB population-health analysts | Review area-level trends, anomalies and supporting evidence | Verify data and interpretation before escalation |
| ICB emergency-preparedness and NHS operational leads | Coordinate a preparedness review and provider readiness discussions | Retain responsibility for escalation and operational decisions |
| NHS provider planning teams | Use a verified regional warning to review capacity and readiness | Do not treat the index as a demand forecast |
| UKHSA Health Protection Teams and local authority public health | Participate in appropriate signal verification and outbreak assessment | Follow established public-health responsibilities and reporting channels |

An ICB or regional NHS analytics team is a plausible pilot client. These are intended
audiences, not existing deployments, commercial agreements or organisational endorsements.
The current application sends only to its configured inbox, not to all these groups.

### What a pilot would need to demonstrate

Assess the workflow with intended users before claiming benefit. Agree the surveillance
outcome and comparator first, then measure detection timeliness, false-alert burden,
missed events, operator review time and usefulness of the proposed actions. Include
report factuality, recipient correctness and delivery auditability. Synthetic index
lead time alone is not a sufficient success measure.

## Architecture

| Component | Responsibility | Key source |
|---|---|---|
| Engine | Seeded telemetry, preprocessing, score, OLS growth fit, forecast, status replay | [engine/](../engine/) |
| Simulation | In-memory timeline, observed-day ingestion, clock, actions and snapshots | [simulation.py](../backend/simulation.py) |
| API | Async FastAPI routes, validation and error mapping | [main.py](../backend/main.py), [schemas.py](../backend/schemas.py) |
| Persistence | SQLite schema, WAL connections, events, episodes and saved PDFs | [db.py](../backend/db.py) |
| Incident worker | CRITICAL-entry summaries, approvals' background execution and error states | [executor.py](../backend/agent/executor.py) |
| Reporting | Gemini REST, Pydantic assessment validation, ReportLab, TLS SMTP | [reporting.py](../backend/agent/reporting.py) |
| Dashboard | React/TypeScript, Leaflet, SVG charts, polling, approvals | [App.tsx](../frontend/src/App.tsx) |

There is no detector training pipeline. Gemini writes explanatory prose only;
the Python engine calculates all scores, forecasts and status thresholds.

### Data flow per simulated day

1. The full seeded timeline exists only in simulation memory, including future days.
2. A tick inserts the next day's telemetry into SQLite.
3. The engine reads the observed SQLite data and scores as of the new day.
4. Status changes become `STATUS_CHANGE` events. Each entry into CRITICAL opens an
   incident with a deterministic short summary and detection-time context.
5. Status writes, incident creation and the logged step commit in the tick transaction.
6. A read snapshot is rebuilt. Transition listeners run after commit, outside the lock.
7. The dashboard fetches map status and incremental events.

A single `threading.Lock` guards simulation state mutations. SQLite WAL lets separate
read connections see committed data rather than partially written ticks. Clock steps
and expensive route work run through `asyncio.to_thread`; reports use a separate
thread pool and do not block the clock.

## Signals, outputs and dashboard meaning

Telemetry is one daily row per zone:

| Field | Units / meaning |
|---|---|
| `wastewater_copies_per_l` | Generated viral copies per litre |
| `er_avg_wait_mins` | Generated mean A&E waiting time in minutes; a nonspecific pressure proxy |
| `mobility_density_score` | Generated 0-100 crowding/mixing index, constant per zone in this model |

`zip_code` is retained as the schema key but holds an **ICB slug**, such as
`greater-manchester`, not a postal code.

The dashboard shows:

- **Outbreak risk now**: the current 0-100 index.
- **Outbreak risk in 48h**: the same index projected two days ahead.
- **Viral doubling time**: estimated doubling of wastewater viral levels, not cases.
  Nonpositive growth reads "Not rising"; unavailable estimates show a dash.
- **England overview**: coverage and factor weights (50% / 35% / 15%).
- **Selected area**: latest factor readings, wastewater/A&E baseline signal levels,
  A&E usual wait, mobility index and each factor's score points. Mobility is not
  baseline-normalised. Displayed integer contributions use largest-remainder rounding
  so they sum to the displayed integer total.
- **History**: solid current risk, dashed 48-hour forecast, injected-surge/alert/crossing
  markers and an observed lead-time caption. A crossing is recorded only once observed.
- **Incident cards**: separate episodes with summary, intended ICB, delivery address,
  approval/dismissal, delivery progress, visible failures and PDF download.

Normal is the UI label for API status `SAFE`. Elevated uses current score > 40.
Critical entry needs projected score >= 80 and `r_hat - 2 * se_r > 0`.
Critical holds until current score < 70 and entry no longer holds.
Missing usable data can produce `INSUFFICIENT_DATA`; see [the detailed rules](MATHS.md#5-alert-status-and-baseline-freezing).

### Map, controls and refresh

The default map uses bundled Natural Earth vector outlines and city labels, so it
does not need a tile service. Optional greyscale OpenStreetMap tiles use integer
zoom levels to avoid seams, falling back to the vector map if loading fails.
Pins share one size; status, selection rings and critical pulses distinguish areas.
There are no stock-transfer arcs or donor camera flights.

Controls include play/pause, step, speed, reset, Simulate spike, Run demo, theme,
help and an optional raw event log. Space, right arrow, R, S and ? are shortcuts,
disabled while typing. There is no first-load welcome popup.

[useSimulation](../frontend/src/state/useSimulation.ts) polls map status and
`events?since_id=...` every second while playing, awaiting approval or processing a
report, and every three seconds otherwise. It refreshes after actions, avoids
overlapping polls and pauses polling in hidden tabs. `clock.run` changes clear run
caches. Incidents are grouped by zone and episode so concurrent outbreaks do not mix.

## Clock and reproducibility

Defaults are 28 historical days plus 14 future days. Days are indexed 0-41:
the initial date is 1 September 2026, and the clock starts on day 27, 28 September.
The dashboard presents assessment dates rather than a "Day X of 41" counter.
Each tick advances one simulated day; the final day automatically pauses play.

Run demo resets, injects Greater Manchester at `r = 0.4/day` on the current day,
and plays at one second per day. Reset without a seed retains the current seed.
A custom reset can supply another seed.

### Invariants

- **Observed past is immutable.** Injection starts on the current day with multiplier
  exactly 1, changing only later days. Ingested rows are not rewritten.
- **No look-ahead.** Future telemetry and injection ground truth are not used to
  calculate the observed score or passed to Gemini.
- **Replayable simulation.** Seed plus the ordered reset/step/trigger/decision log
  reproduces deterministic state. Clock ticks are logged as steps. Replay disables
  external report dispatch; asynchronous report events and wall-clock timestamps
  are outside deterministic comparisons.
- **One incident per entry.** `agent_episodes.status_event_id` is UNIQUE. A later
  CRITICAL entry can create a separate episode.

Multiple different zones may have injected outbreaks. The API permits only one
injected outbreak per zone per run; a second returns 409, even if its alert has closed.

### Persistence is deliberately demo-scoped

SQLite stores zones, observed telemetry, latest status, events, episodes, PDF bytes
and the action log. `hospital_inventories` and `transfers` remain for compatibility;
stock is seeded on reset and never transferred by the current workflow.

Browser reload preserves the current database state. Backend startup and run reset
clear per-run data and reports; startup also reloads the CSV roster. A schema-version
mismatch rebuilds demo tables rather than migrating production records.
This is not a durable surveillance archive.

## Approved report lifecycle

On CRITICAL entry, the application captures the area's observed metrics, date,
metadata, summary and current configured recipient. There is **no approval deadline
and no automatic approval**.

| State | Meaning |
|---|---|
| `awaiting_approval` | Operator has not decided |
| `rejected` | Operator dismissed; no report dispatch |
| `queued` | Explicit approval or retry has queued work |
| `generating` | Background worker validates configuration and generates/reuses the PDF |
| `sending` | PDF saved; SMTP submission begins |
| `sent` | SMTP server accepted the message, not proof of inbox arrival |
| `failed` | Definite configuration, generation or submission failure; explicit retry allowed |
| `delivery_unknown` | Submission may have succeeded; retry disabled to avoid duplicates |

The report process:

1. Validate Gemini credentials, one sender/recipient address, port and TLS mode.
2. Send the detection-time context to Gemini's `generateContent` REST endpoint.
3. Require a completed structured JSON response with `executive_summary`, `assessment`,
   `recommended_actions` and `limitations`. Unknown fields are forbidden.
4. Enforce nonempty bounded strings, three or four actions and a combined narrative
   limit of 350 whitespace-delimited words. Proposed owners/timeframes are prompt
   requirements, not separately machine-validated clinical facts.
5. Render a PDF with deterministic evidence table, AI prose, model, intended ICB,
   configured delivery address, limitations and exercise labels.
6. Save the PDF and submit one attachment via TLS SMTP.

The prompt requests signal verification, liaison by the ICB with UKHSA/local public
health, and provider readiness review, each with a team, timeframe and concrete output.
It forbids invented measurements, diagnoses, contacts and claims that action occurred.
**There is no general numeric-fact checker or clinical validation of generated prose.**
The evidence table comes from stored data; the narrative still needs human judgement.

Approval is permission to generate **and email**; it is not a final-text preview.
Retries reuse a saved PDF instead of calling Gemini again. Errors are visible and
provider/SMTP secrets are not included in operator-facing failures.

A generation counter rejects stale worker progress after reset. Once sending begins,
a message can still be submitted; reset cannot recall it. There is no durable job queue
or end-to-end exactly-once email guarantee.

### Authority versus actual recipient

The affected NHS ICB is the **intended authority** for NHS preparedness review.
UKHSA Health Protection Teams and local authority public health are relevant partners
for outbreak assessment and response:
[UKHSA guidance](https://www.gov.uk/health-protection-team) and
[NHS England ICB guidance](https://www.england.nhs.uk/publication/clinical-response-to-local-incidents-and-outbreaks-of-infectious-disease-commissioning-guidance-for-icbs/).

The application does not look up contacts or route by ICB. It emails **only the one
configured `ALERT_RECIPIENT`**, captured when each incident opens. The UI says
"Delivery address"; PDFs/emails explicitly retain exercise and test-delivery wording.
No additional authority, UKHSA team or council is notified automatically.
Only use an authorised recipient, especially if configuring an NHS address.

## API reference

All paths are prefixed with `/api/v1`. Live request/response schemas are exposed at
FastAPI's `/docs`; source models are in [schemas.py](../backend/schemas.py).

| Method | Path | Body / purpose |
|---|---|---|
| GET | `/health` | Health and roster count |
| GET | `/map-status` | Clock, current zones with telemetry/contributions, pending approvals |
| GET | `/events` | `since_id` (exclusive), `limit`, optional comma-separated `types`; returns `events`, `last_id` |
| GET | `/zones/{zip_code}/history` | Observed daily status/current/projected scores |
| GET | `/inventory` | Compatibility endpoint; seeded current/initial facility stock |
| POST | `/trigger-outbreak` | `{"zone":"greater-manchester","r":0.4}` |
| POST | `/clock/play` | Optional `{"seconds_per_day":1.0}` |
| POST | `/clock/pause` | No body |
| POST | `/clock/step` | No body; advance one day |
| POST | `/clock/reset` | Optional `{"seed":42}` |
| POST | `/episodes/{episode_id}/approve` | Approve generation and email |
| POST | `/episodes/{episode_id}/override` | Dismiss without sending |
| POST | `/episodes/{episode_id}/retry` | Retry only a definitively failed approved report |
| GET | `/episodes/{episode_id}/report.pdf` | Download saved PDF; unavailable before generation |

Simulation errors map to 404 for unknown zones/episodes, 409 for conflicting state,
and 422 for invalid inputs. Outbreak `r` is constrained to 0.05-1.0/day; speed to
0.25-10.0 seconds/day. FastAPI also validates request structure.

Principal event types are `OUTBREAK_INJECTED`, `STATUS_CHANGE`, `INCIDENT_OPENED`,
`INCIDENT_DECISION`, `REPORT_STATUS` and `TIMELINE_END`. There are no active allocation,
rideshare or briefing events.

## ICB coverage

[zones.csv](../engine/zones.csv) follows England's 36 ICBs effective **1 April 2026**.
Display names omit the common NHS prefix and Integrated Care Board suffix.
Zone count always comes from the file. Sources:
[ONS register](https://geoportal.statistics.gov.uk/datasets/integrated-care-boards-april-2026-names-and-codes-in-en/explore)
and [NHS ODS merger summary](https://digital.nhs.uk/services/organisation-data-service/upcoming-code-changes/icb-mergers-2026-change-summary).

| Successor ICB | Former areas represented |
|---|---|
| Central East | Bedfordshire, Luton and Milton Keynes; Cambridgeshire and Peterborough; Hertfordshire excluding West Essex |
| Essex | Mid and South Essex; West Essex; North East Essex |
| Norfolk and Suffolk | Norfolk and Waveney; Suffolk excluding North East Essex |
| West and North London | North West London; North Central London |
| Thames Valley | Buckinghamshire, Oxfordshire and Berkshire West; East Berkshire from Frimley |
| Surrey and Sussex | Surrey Heartlands; Sussex; Surrey parts of Frimley |

Hampshire and Isle of Wight also incorporates former Frimley areas in Hampshire.
Coordinates are representative pins, not boundary polygons. Population values are
rounded sizing estimates; split areas are apportioned without double counting.
The approximate total of 58,300,000 is preserved from the earlier demo, not an official
2026 population estimate.

Changing roster order/count changes seeded draws. Historical 42-zone results and old
screenshots must not be presented as current 36-ICB validation.

## Deployment constraints

Use one backend process/worker locally. Multiple workers would each initialise a
clock and reset the shared database; horizontal scaling is not implemented.
There is no authentication or authorisation boundary on "operator" actions.
Public exposure, live data ingestion or real-authority alerts require a separate
production design, validated models/data, governance, access controls and delivery auditing.

## Proposed scaling path (not implemented)

Scaling means both handling more data and operating safely across more organisations.
Adding web workers to this prototype is not a safe scaling strategy: simulation state
is process-local and startup deliberately resets demo records.

### 1. Establish a governed data pilot

- Agree a specific use case, accountable clinical/public-health owners and an escalation
  protocol with a participating organisation.
- Obtain authorised feeds and document their purpose, licensing, retention and access
  requirements. Prefer aggregate data where sufficient; assess disclosure risk rather
  than assuming aggregation removes it.
- Define ingestion contracts for units, timestamps, reporting delays, revisions,
  missingness and geographic coverage. Wastewater catchments and hospital populations
  will not necessarily align with ICB boundaries; geographic mapping needs validation.
- Validate against agreed outcomes across areas, seasons and pathogens. Reassess the
  synthetic weights, lag assumptions and thresholds rather than treating them as
  transferable clinical parameters. Resolve the current false-critical requirement
  failure before claiming that requirement is met.

### 2. Separate ingestion, scoring, API and delivery

- Replace demo startup/reset semantics with durable migrations and retained observations,
  assessments and audit records. A managed relational database such as PostgreSQL is a
  candidate when concurrent workloads outgrow SQLite; choose it from measured needs.
- Run ingestion and scheduled scoring independently of stateless API replicas. Partition
  work by area and assessment date, with a single owner or coordinated job claim per
  assessment to prevent duplicate decisions.
- Preserve as-of data versions and engine/configuration versions so revised feeds do
  not silently rewrite previously issued assessments.
- Move reports to durable queued workers, persist retry state and use a transactional
  outbox between approved decisions and dispatch jobs. Add deduplication and delivery
  reconciliation; do not promise exactly-once SMTP delivery.
- Store PDFs in access-controlled object storage with a defined retention policy rather
  than growing the operational database indefinitely.

### 3. Make organisation boundaries and review explicit

- Add authenticated identities, organisation-scoped access, role-based approval and
  auditable decisions before exposing the service beyond a local pilot.
- Replace the single recipient setting with a maintained, verified routing directory
  and an agreed escalation policy. Keep exercise delivery distinct from live channels.
- Provide a final-text review step if required by governance; today's approval occurs
  before AI text exists. Validate generated advice against evidence and retain a
  non-generative reporting path when a provider is unavailable.
- Review what data may leave the organisation for Gemini processing, with suitable
  contractual, privacy and security controls. The AI must remain separate from scoring
  and cannot become an unreviewed source of clinical decisions.

### 4. Scale from observed bottlenecks

Daily area-level scoring and occasional reports have different resource needs.
Measure ingestion freshness, scoring time, API latency, queue age, generation failures,
delivery uncertainty and operator alert burden before choosing capacity targets.
Batch database reads and assess incremental rolling calculations against the existing
replay implementation for equivalence. Scale report workers separately, with bounded
concurrency, provider quotas and cost limits, so slow AI calls do not delay scoring.

Expand to additional geographies only after validating their mappings and baselines.
Additional pathogens need explicit signal definitions and separate validation; a larger
roster or a different model name does not by itself make the detector generalisable.
These are proposed engineering and governance steps, not current platform capabilities
or a delivery commitment.
