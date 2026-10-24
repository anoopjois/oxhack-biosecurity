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
| `scripts/` | Dev-only tools, such as `plot_outbreak.py` (matplotlib, from `requirements-dev.txt`). The demo never needs them. |

## Zones

- England's 42 ICBs, as listed in `docs/SPEC.md`, are stored in `engine/zones.csv`.
- Columns are `zip_code`, `zone_name`, `region`, `latitude`, `longitude` and
  `population`.
- `zip_code` holds a **slug ID** such as `north-central-london`.
- `zone_name` holds the **current official ICB name**, not the outdated names in the
  spec.
- Coordinates and populations are approximate.
- **The zone count always comes from the file.** Never hardcode 42.

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

**Measured in Phase 1** (200 seeds, r = 0.4, onset on day 28):
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
1. **Deterministic allocation.**
   - Donors are SAFE zones, ranked by distance.
   - Each donor transfers `min(deficit, donor stock above its safety level)` for each
     of PPE, antivirals and vaccines.
2. **LLM.**
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

## API

- `GET  /api/v1/map-status`
- `GET  /api/v1/events`
- `GET  /api/v1/inventory`
- `POST /api/v1/trigger-outbreak` with body `{zone, r}`
- `POST /api/v1/clock/play`, `/api/v1/clock/pause`, `/api/v1/clock/step`,
  `/api/v1/clock/reset`

## Frontend

- **Map:** England, with zone pins coloured by status.
- **Header:** the clock (date, play/pause/step) and a **Simulate Pathogen Spike** button.
- **Side panel:** the live event feed and agent directives.
- **Bottom:** an inventory bar chart comparing before and after.
- **Zone popup:** score, projected score and doubling time.

## Build phases

Phases 0–5 are approved. Each phase still follows the loop
propose → approve → build → test → commit.

0. Scaffold: layout, `dev.sh`, `.env.example`, `zones.csv`, `engine/config.py`.
1. Engine: generator, preprocessing, scoring, forecast, status replay, and the 4
   required tests.
2. Backend core: SQLite, seeding, simulation clock, `map-status`,
   `trigger-outbreak`, clock routes.
3. Agent: allocation, LLM with validated JSON, template fallback, executor,
   rideshare mock, `events` and `inventory`.
4. Frontend: map, header and clock, spike modal, event feed, inventory chart, popups.
5. Demo polish: end-to-end rehearsal, `docs/MATHS.md`, README.

### Optional phases

These run only after the demo works end to end. **The demo must never depend on
either one.** The default config always uses the hand-set `combine()` and needs no
network access.

**6. ML calibration (optional)**
- Fit a logistic regression on simulated outbreaks.
- Features: `z_W`, `z_E`, `M`, `r_hat` and `r_hat / se_r`.
- Label: "the outbreak crosses severity within 48h".
  - Severity comes from **ground truth**: the true ER excess passing a config
    threshold.
  - It never comes from the hand-set score, or the model would just learn to copy
    `combine()`.
- Implementation: plain numpy.
  - Logistic regression is fitted by IRLS (Newton's method).
  - The AUC is the Mann–Whitney statistic.
  - No scikit-learn.
- Split train and test **by seed**, so the same simulated world never appears on
  both sides.
- Report the AUC and the ROC curve.
- Choose the alert threshold from a false-alarm budget, i.e. the largest threshold
  whose false-positive rate on clean zones stays within budget.
- A config flag switches between the hand-set `combine()` and the fitted model. The
  hand-set version is the default.

**7. Real-data validation (optional, time-boxed)**
- Use public US wastewater surveillance data and hospital admissions data to
  estimate the real lead time from wastewater to hospital load. This is evidence
  for the lag assumption `L = 4`.
- This is a standalone analysis. It is never imported by `backend/`, and the raw
  data is gitignored.
- **Time-boxed.** If data access is painful, drop the phase.

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
- **Zones.** The 42 English ICBs replace the spec's "5 zip codes". The `zip_code`
  column name is kept for schema compatibility.
- **Stack.** The spec's Next.js/Streamlit options are replaced by React + Vite.
