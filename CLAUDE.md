# CLAUDE.md: standing brief

Biosecurity early-warning system plus logistics autobalancer. It is a hackathon demo
built in phases, and **all data is synthetic**.

`docs/SPEC.md` is the original pitch and spec. **Where this file differs from the spec,
this file wins.** The overrides are listed at the bottom.

---

## Working rules

- **Each phase follows the same loop:** propose the phase, wait for approval, build it,
  test it, commit it. Never start the next phase without approval.
- **Constants live in config and are never hardcoded.** All windows are measured in
  **days**.
  - Every maths and generator constant goes in `engine/config.py`.
  - App settings go in `backend/config.py`, which reads `.env`. These cover paths,
    clock speed, the LLM model and inventory levels.
- **Keep the maths readable and commented.** The author is a maths student who must
  explain every formula to judges:
  - Name variables after the maths (`z_W`, `r_hat`, `se_r`).
  - Docstrings state the formula.
  - Prefer clarity over cleverness.
- **Don't silently tune constants to make a test pass.** If a required test fails,
  report it and discuss it first.
- Secrets live in `.env`, which is gitignored. Keep `.env.example` up to date.

## Stack

| Path | What |
|---|---|
| `engine/` | Python package of **pure functions**: generator, scoring, forecasting, status. It has no I/O beyond reading `zones.csv`. |
| `backend/` | Python 3, FastAPI, SQLite, numpy, pandas, pytest. It imports `engine/` directly and owns the simulation clock, the DB, the agent and the API. |
| `frontend/` | React, Vite and TypeScript, with react-leaflet (OpenStreetMap tiles) and recharts. |
| `./dev.sh` | One command that starts everything locally. |
| `scripts/` | Dev-only tools, such as `plot_outbreak.py` (matplotlib, from `requirements-dev.txt`) and `lead_vs_r.py` (lead time across growth rates). The demo never needs them. |

## Zones

- England's 36 ICBs effective 1 April 2026 are stored in `engine/zones.csv`.
  `README.md` records the ONS source and the merger/boundary changes.
- Columns are `zip_code`, `zone_name`, `region`, `latitude`, `longitude` and
  `population`.
- `zip_code` holds a **slug ID** such as `west-and-north-london`.
- `zone_name` holds the **current official ICB name**, not the outdated names in the
  spec.
- Coordinates and populations are approximate.
- **The zone count always comes from the file.** Never hardcode the runtime count.

## Engine maths

These are statistical methods, not ML.

### Preprocessing
- Resample the data to one row per zone per day. Missing days are forward-filled for at most
  2 consecutive days; any further days in a longer gap stay NaN.
- Floor wastewater at `DETECTION_LIMIT` before taking logs.
- `y(t) = log(max(W(t), DL))` is the **raw** daily log wastewater.
- `x(t) = log(3-day trailing mean of wastewater)` is the smoothed version.

### Baseline and z-scores
- The baseline is the per-zone mean and std over days **t-17 .. t-4**. The 4-day gap
  stops a fresh rise from contaminating its own baseline.
- `z_W = (x − μ_x) / max(σ_x, SIGMA/√3)`. The floor is the known log-noise SD of a
  3-day mean (SIGMA = 0.3).
- `z_E = (ER − μ_E) / max(σ_E, ER_NOISE_SD)`.
- The std floors equal the known noise, so a quiet baseline can't produce huge z-values.

### Score
- `s(z) = 1 / (1 + exp(−(z − 2)))` is a logistic function centred at z = 2.
- `score = 100 · (0.5·s_W + 0.35·s_E + 0.15·M)`, where `M = mobility/100`. The score
  is clipped to [0, 100].
- `combine()` is the single function that implements this formula. It is reused for
  the projected score.

### Forecast
- Fit OLS of **raw daily** log wastewater on day over the last 7 days. This gives
  `r_hat` (growth rate per day), its standard error `se_r`, and the doubling time
  `ln2 / r_hat` when `r_hat > 0`.
- Project `x` forward to t+2 using `r_hat`.
- Project ER using the lag `L = 4`. ER(t+2) depends on wastewater at t−2. This is
  the "V5" estimator, chosen by prototype in Phase 1:
  - Estimate log W(t−2) from the **fitted OLS line** at centred day d = +1:
    `ŷ(t−2) = ȳ + r_hat · 1`.
  - Use the baseline mean of **raw** y, `μ_y`:
    `ER_hat(t+2) = μ_E + BETA_ER · (ŷ(t−2) − μ_y)`.
  - `BETA_ER` is a calibration constant, matched to the generator's 20.
  - **Why not x(t−2)?** The 3-day mean lags about 1 day. The fitted line has no lag,
    and its SD is about σ·√(1/7 + 1/28) ≈ 0.13, below x's ≈ 0.17.
  - **What data it uses:** only data up to t (no look-ahead). This includes y(t−1) and
    y(t). Asserting `H ≤ L` keeps day t+H−L inside the fit window, so the estimate is
    interpolation, not extrapolation.
  - **Known bias:** when the 7-day window straddles the outbreak's onset (k < 6 days
    since onset), the straight line overshoots the kink. The bias is upward and vanishes
    by k = 6. It adds a little lead time and doesn't affect clean zones.
- `projected_score = combine(z of projected x, z of projected ER, M)`.

### Status
Status is computed **statelessly** by replaying the days in order up to the as-of date.

| Status | Rule |
|---|---|
| `INSUFFICIENT_DATA` | During warm-up, while there is not enough history for the baseline window. |
| `CRITICAL` (enter) | `projected_score ≥ 80` **and** `r_hat − 2·se_r > 0` (growth is significantly positive). |
| `CRITICAL` (hold) | The zone stays CRITICAL until its **current score < 70 *and* the entry condition no longer holds**. CRITICAL fires before the current score reaches 70, so a pure current-score exit would drop the alert the next day. |
| `ELEVATED` | `score > 40` |
| `SAFE` | Anything else. |

While a zone is CRITICAL, its baselines are **frozen** at the window t−17..t−4 from the
day it entered CRITICAL. They unfreeze on the day it exits.

### Required tests
1. Zero CRITICAL statuses on clean zones, across 200 seeds.
2. CRITICAL comes **on or before** the day the current score crosses 80 in ≥ 95% of
   seeds, and the **median lead is ≥ 2 days**.
   - Report the spread of lead times.
   - Also report the yellow-warning timing: the first ELEVATED day after onset, as
     k = days since onset.
   - These are the pitch numbers.

**Measured in Phase 1, historical 42-ICB roster** (200 seeds, r = 0.4, onset on day 28):
- Zero CRITICAL in 193,200 clean zone-days. ELEVATED on 3.1% of clean zone-days.
- Red lead: mean 2.25 days, median 2; on or before the crossing in 100% of seeds.
- Median k (days since onset):

  | Event | Median k |
  |---|---|
  | First yellow or red | 2 |
  | First red (CRITICAL) | 4 |
  | Current score ≥ 80 | 6 |

- No alert faded before onset + 12.
3. No look-ahead: changing data after the as-of date never changes the output.
4. The alert does not fade before onset + 12 days.

**Current 36-ICB revalidation:** 1 CRITICAL zone-day in 165,600 clean zone-days, so
required test 1 fails. The user approved retaining the revised roster and unchanged
maths with this failure documented; do not hide it or relax the test. The remaining
96 engine/backend tests pass. Red lead remains median 2 days, mean 2.245 days, and
on or before the crossing in 100% of seeds. See `docs/MATHS.md` for current results.

## Generator

The generator lives in `engine/`. It is pure and seeded, and it also returns ground truth.

- **Wastewater:** a per-zone baseline multiplied by lognormal noise (σ = 0.3).
- **ER:** `ER(t) = baseline + 20 · (log W_true(t−4) − log W_baseline) + noise`.
- **Mobility:** stable per zone.
- **`inject_outbreak(zone, r, start_day)`:**
  - True wastewater grows as `exp(r · (d − start_day))` for d ≥ start_day, with
    r ≈ 0.4/day.
  - ER follows through the 4-day lag.
  - The multiplier is 1 on the start day itself.

## Simulation clock

The backend owns the clock.

- Pre-generate 28 days of history plus 14 clean future days for every zone.
- The clock starts at the end of the history.
- Controls are play, pause, step and speed. Each tick advances one simulated day and
  rescores everything as of that day.
- The clock **auto-pauses** at the last pre-generated day.
- **Outbreaks.** A second outbreak in a zone that already has one returns **409**.
  Different zones can have outbreaks at the same time.

### Backend design (Phase 2)
- **Where data lives.**
  - The full timeline, including the future, lives only in memory, in
    `backend/simulation.py`.
  - Each tick *ingests* one more day of telemetry into SQLite.
  - The engine scores from SQLite, so the DB never contains future rows.
- **Thread safety.**
  - One `threading.Lock` guards all simulation state.
  - Each mutation and its SQLite writes happen in one transaction.
  - Readers get a snapshot that is rebuilt after every mutation.
  - The clock is an asyncio task that runs `step()` through `asyncio.to_thread`.
- **Invariant I1: the past on screen never changes.**
  - An injected outbreak starts at the current day, where its multiplier is 1, so
    only later days change.
  - Ingested telemetry is never rewritten.
- **Invariant I2: reproducibility.**
  - State is a function of the seed plus the ordered `actions` log: reset, step
    and trigger. Clock ticks are logged as steps.
  - `apply_actions` replays the log. Wall-clock timestamps are excluded from
    comparisons.
- **Transitions.**
  - Every status change becomes a `STATUS_CHANGE` event, written in the tick's
    transaction.
  - Listeners registered with `add_transition_listener` receive the transitions
    after the commit, outside the lock.
- `POST /api/v1/clock/reset` regenerates the data and restores the starting state.
- **Simulate Pathogen Spike** takes a zone and r. It injects an outbreak into the
  future rows, starting from the current day.

## Agent

The agent runs when a zone **transitions** to CRITICAL.

0. **Inventory model.**
   - Each zone has **one supply hub**.
   - Stock targets scale with population.
   - `deficit = surge target − stock`.
   - Each donor keeps a per-capita safety level.
1. **Deterministic allocation** runs **inside the tick**, which keeps it reproducible.
   - Donors are SAFE zones, ranked by distance.
   - Each donor transfers `min(deficit, donor stock above its safety level)` for each
     of PPE, antivirals and vaccines.
2. **LLM.** It runs **asynchronously** and never blocks the clock. Its text is not
   reproducible, and it never affects quantities.
   - The provider is Claude, called through `ANTHROPIC_API_KEY`. The model name lives
     in backend config.
   - It receives the context and the already-computed transfers.
   - It returns JSON containing a rationale and containment directives.
   - **It never sets quantities.** Validate its JSON against a schema.
3. **Template fallback** is used if there is no API key or the call fails or fails
   validation.
4. **Executor.**
   - Updates SQLite inventory and logs the events.
   - Calls a mock rideshare webhook ("pooled rides disabled in <zone>").

### Agent design (Phase 3)
Code lives in `backend/agent/`: `allocation.py` (pure maths), `executor.py`,
`template.py`, `briefing.py`, `llm.py` and `worker.py`.

**Allocation formulas**
- `T_k = 2.0 · ℓ_k · P` is the surge target, where ℓ_k is the seeding per-capita level.
- `F_j,k = ceil(0.6 · ℓ_k · P_j)` is the donor safety level.
- `U_j,k = max(0, S_j,k − F_j,k)` is the donor surplus.

**Allocation rules**
- Donors must be SAFE right now. They are ranked by haversine distance, with
  `zip_code` breaking ties.
- Greedy fill, at most `MAX_DONORS = 3` per alert.
- Same-tick alerts are processed highest projected score first, with `zip_code`
  breaking ties.

**Invariants (tested)**
- Total stock never changes.
- No donor ends below its safety level.
- Exactly one episode per CRITICAL entry: `agent_episodes.status_event_id` is `UNIQUE`.
- When an episode closes, pooled rides are re-enabled. Stock is not returned.

**Events, in tick order**
1. `AGENT_ALLOCATION` (the proposal; see Phase 5)
   - With no approval step, or nothing to move, `AGENT_DECISION` (`by: policy`) follows at once.
2. `AGENT_DIRECTIVE`, carrying `source` and `source_label`:
   - `template` is labelled **"Rule-based briefing"**;
   - `llm` is labelled **"AI briefing (Claude)"**.
3. `RIDESHARE_WEBHOOK`, with direction `disable` or `enable`.

**LLM**
- Defaults: `LLM_MODEL=claude-opus-5-5`, `LLM_EFFORT=low`.
- The request uses `client.beta.messages.create` with:
  - structured outputs (`DIRECTIVE_SCHEMA`, which has no quantity fields);
  - `fallbacks="default"` (beta `server-side-fallback-2026-07-01`);
  - a 15 s timeout and 1 retry.
- It runs on a background thread pool after the tick commits.
- A reset bumps `Simulation.generation`, and late results from before the reset are
  discarded.

**Briefing validation (both template and LLM)**
- Pydantic schema; unknown fields are dropped and reported as `ignored_fields`.
- **Number check:** every integer ≥ 100 in the text must appear in the episode
  context.
- Any failure keeps the rule-based briefing. `agent_episodes.llm_status` records why.

**Reproducibility**
- Comparisons exclude `source: "llm"` events.
- When an LLM is active, comparisons also exclude event ids, because AI events take
  ids whenever they arrive.

**Testing and the real call**
- Tests never call the API: fixtures pass `directive_writer=None` or a fake writer.
- `scripts/llm_smoke.py` makes one real call with a real episode context. Run it
  manually once a key exists.

### Human approval and donor reserve (Phase 5)
Judges will ask whether an AI should move medical supplies on its own. The answer is
"it proposes; a person can stop it; silence counts as consent after 30 s".

**Approval flow**
- A CRITICAL entry only **proposes** its transfers. The plan is stored in
  `agent_episodes.plan` with `decision = pending`, and no stock moves.
- `POST /episodes/{id}/approve` moves the stock. `POST /episodes/{id}/override` moves
  nothing. A second decision returns 409.
- `APPROVAL_TIMEOUT_S` (default 30, wall clock) auto-approves (`by: timeout`).
  - `run_approvals` in `backend/clock.py` polls every `APPROVAL_POLL_S`.
  - `0` turns the approval step off: stock moves in the tick (`by: policy`). Most tests use
    this setting; `test_approval.py` turns the step on.
- **The clock is held** while any decision is pending:
  - `clock.awaiting_approval` is true;
  - `step` raises `AwaitingApproval` (409);
  - the clock loop stays in play mode and resumes by itself after the decision.
- Every decision writes an `AGENT_DECISION` event (`decision`, `by`, actual transfers).

**Invariants (tested)**
- **Reservations:** same-tick proposals are computed as if every pending plan were already
  applied. Donors only give, so approving or overriding any subset of plans keeps every
  donor at or above its safety level, and total stock is conserved.
- **I2:** decisions are logged as `decide_allocation` actions (including `by: timeout`), so
  `apply_actions` replays them exactly.

**Donor reserve, in days**
- `u_k = ℓ_k·P / NORMAL_STOCK_DAYS` (D = 7) is normal daily use.
- `R = min_k S_k / u_k` is the days the scarcest item lasts.
- The safety level guarantees `R ≥ SAFETY_FRACTION·D = 4.2` days.
- A large surge deficit takes each donor's full surplus, so donors often end exactly at
  4.2 days.
- It is shown on the incident card, in the details table and on the map's arc labels.

**Frontend**
- Approval box: a countdown ring with **Approve now** and **Override**. It scrolls into view
  when it appears.
- Arcs stay while a decision is pending and clear on override.
- Map zoom buttons +, − and ⤢ (back to England) step by whole zoom levels.
- Theme: Auto / Light / Dark, set from the header button or the "?" menu. It is stored in
  `localStorage` and applied as `data-theme` on `<html>`. Every colour is a CSS token.

## API

- `GET  /api/v1/map-status`
- `GET  /api/v1/events`
- `GET  /api/v1/inventory`
- `POST /api/v1/trigger-outbreak` with body `{zone, r}`
- `POST /api/v1/clock/play`, `/api/v1/clock/pause`, `/api/v1/clock/step`,
  `/api/v1/clock/reset`
- `POST /api/v1/episodes/{id}/approve`, `/api/v1/episodes/{id}/override`
- `GET  /api/v1/zones/{zip_code}/history`

## Frontend

- **Map:** England, with zone pins coloured by status.
- **Header:** the clock (date, play/pause/step) and a **Simulate Pathogen Spike** button.
- **Side panel:** the live event feed and agent directives.
- **Bottom:** an inventory bar chart comparing before and after.
- **Zone popup:** score, projected score and doubling time.

### Frontend design (Phase 4, redesigned)
**Look**
- Calm, judge-friendly UI.
- One blue accent (`#2a78d6`) for interface elements. Red only ever means CRITICAL;
  amber means ELEVATED; muted sage means SAFE, labelled "Normal".
- Spacing 4/8/12/16/24. Fluid base type 14–18px.
- Header (64px) and timeline (64px) have fixed heights, so the map sits on whole
  pixels.

**Layout**
- Header: brand, SIMULATED DATA badge, date + "Day N of 41", and controls:
  - a quiet group: play/pause, step, speed menu, reset;
  - "⚠ Simulate spike" (opens a popover; a click on the map picks the area);
  - **★ Run demo**, the only primary button;
  - "?": help & settings, holding shortcuts, map style, the raw log toggle and the
    risk-score explanation.
- Map (left).
- Side column: zone card above incident cards.
- Timeline bar along the bottom.

**Map**
- Default basemap: built-in vector (Natural Earth outline plus a few city names that
  avoid pins). It is seam-free, fits England tightly, works offline, and `maxBounds`
  stops panning away.
- Optional greyscale OSM tiles at **integer zoom only**. Fractional zoom makes browsers
  scale each tile separately and leaves hairline seams; this was measured in Chromium
  and WebKit.
- If tiles fail, the map falls back to the vector basemap with an "Offline" chip.
- Pins: a 7px dot inside a 16px ring, all the same size.
  - Colour comes from CSS via `data-status`, so state changes ease over 600 ms.
  - CRITICAL adds an outward pulse; selected areas get a dark outer ring.
- Labels: pinned only for CRITICAL and selected areas (as markers, on whichever side
  covers fewer pins); every other area shows its name on hover.
- On a new allocation the camera flies to the target and donors, and arcs are labelled
  at the donor end. After 20 s the map flies back.

**Zone card**
- Stats: Outbreak risk now, Outbreak risk in 48h, Viral doubling time, each with a "?"
  tooltip.
- Custom SVG chart: Risk now (solid black) vs "Forecast, 48 hours ahead" (dashed
  blue), with Spike and Alert pills, a shaded lead band and a hover readout.
- A prominent lead caption.
- "What's driving this area's risk": each signal's latest reading, its level against the
  area's own baseline, and the points it adds (`map-status` `contributions`, from
  `engine.scoring.score_contributions`; they sum to the score and are displayed with
  largest-remainder rounding so they add up to the shown score).
- With nothing selected: an England overview, which shows the factor weights instead.

**Incident cards** (`lib/incidents.ts`)
- One card per outbreak, routed by zone and then by episode id, so simultaneous
  outbreaks never interleave.
- Steps: Simulated spike (greyed and dashed, "hidden from the system") → Detected →
  Stock moved (the inventory summary, details expandable) → Briefing (the AI version
  replaces the rule-based one in place) → Containment.

**Timeline**
- Days 0–41 as a track, with recorded history shaded and a "Today" cursor.
- Markers: Spike, Alert raised, Would have hit 80.

**Controls**
- Open directly to the dashboard, without a first-load welcome popup. Run demo stays in the header.
- End-of-timeline bar ("Timeline ended · Reset · Replay demo"); disabled controls
  explain why in a tooltip.
- **Run demo:** reset, inject Greater Manchester at r = 0.4, play at 1 s/day.
- Shortcuts Space, →, R, S, ?, which never fire while typing.

**Data**
- `useSimulation` polls `map-status` and events by `since_id`: every 1 s while
  playing, 3 s while paused, and right after every action.
- `clock.run` changes clear all caches.
- The first events fetch of a run is a baseline, so a reload never replays old
  allocations.

**Backend additions**
- `GET /api/v1/zones/{zip}/history`, `er_baseline`, `clock.run`.
- A `PRAGMA user_version` schema check.

**Verification**
- `cd frontend && npm test` (vitest).
- `npx playwright test`: 6 projects (Chromium and WebKit × 1280×720, 1440×900,
  1920×1080), with screenshots written to `$SHOTS`.
- `docs/DEMO_CHECKLIST.md`.
- Key screenshots are in `docs/figures/ui-*.png`.

## Docs (Phase 5)
- `README.md`: overview, quickstart, Mermaid architecture, how to run each test layer.
- `docs/MATHS.md`: judge-facing maths, measured results (each with the test that produced
  it) and limitations. Keep its numbers in sync with `test_required.py` output and
  `scripts/lead_vs_r.py`.
- `docs/DEMO_SCRIPT.md`: the 3-minute talk track synced to Run demo, and judge Q&A.
- `docs/DEMO_CHECKLIST.md`: pre-show setup and click-by-click checks.
- Playwright reads `FRONTEND_PORT` (like Vite and `dev.sh`), so a second checkout on other
  ports never reuses another checkout's server.

## Overrides of docs/SPEC.md

- **Risk formula.** The spec's velocity-based formula is replaced by the
  z-score → logistic → weighted-sum maths above.
- **Thresholds.** CRITICAL now needs a projected score ≥ 80 plus significant growth,
  with hysteresis at 70. The threshold 40 still separates SAFE from ELEVATED.
- **Outbreak injection.** `trigger-outbreak` takes `{zone, r}`. The spec's
  multiplier and ER add-on are dropped.
- **Execution.** `POST /execute-autobalance` is dropped, because the agent executes
  internally on a transition.
- **LLM.** The provider is Claude instead of the spec's Gemini 1.5. The LLM only
  writes the rationale and directives. Quantities are computed deterministically.
- **Zones.** The 36 English ICBs (April 2026) replace the spec's "5 zip codes". The `zip_code`
  column name is kept for schema compatibility.
- **Stack.** The spec's Next.js/Streamlit options are replaced by React + Vite.
