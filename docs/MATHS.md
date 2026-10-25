# BioSecure maths and validation

The engine computes a current risk index, a two-day forecast and a status from
synthetic area-level signals. This document describes the **implemented statistical
model**, not an epidemiologically calibrated probability model.

All windows are in days, all logarithms are natural, and `t` is the as-of day.
Maths/generator constants live in [engine/config.py](../engine/config.py).
Application/reporting settings live in [backend/config.py](../backend/config.py).
See [system design](SPEC.md) for the clock, API and approved reporting workflow.

## 1. Signals and synthetic generator

The current roster has 36 ICBs, loaded from [zones.csv](../engine/zones.csv).
Each zone has daily:

| Input | Symbol | Units / model role |
|---|---|---|
| Wastewater viral load | `W(t)` | Copies/litre; primary growth signal |
| A&E average wait | `ER(t)` | Minutes; nonspecific service-pressure signal |
| Mobility/crowding | `M(t)` | Input index divided by 100; additive score component |

Mobility is constant per zone in this generator. It is **not** a multiplier of the
other two score components, and its constancy means it supplies no trend detection.

[generator.py](../engine/generator.py) draws zone baselines and noise once per seed:

```text
W_base: log-uniform from 50,000 to 500,000 copies/litre
ER_base: uniform from 30 to 90 minutes
mobility index: uniform from 20 to 80
epsilon(d): independent Normal(0, 0.3)
nu(d): independent Normal(0, 5 minutes)

log W_true(d) = log W_base + r * max(0, d - start_day)
W(d)         = W_true(d) * exp(epsilon(d))
ER(d)        = ER_base + 20 * (log W_true(d - 4) - log W_base) + nu(d)
```

Before the timeline starts, lagged wastewater is taken to be baseline. A clean zone
has no growth term. The default injected `r` is 0.4/day, giving true doubling time
`ln(2)/0.4`, approximately 1.7 days. At `start_day` itself the multiplier is 1.

Injection rerenders using the same parameters and stored noise, leaving all rows on
or before the start day unchanged. Ground truth is returned for tests/simulation,
not passed to the detector or Gemini. The backend permits one injected outbreak per
zone per run, but different zones can have outbreaks simultaneously.

These assumptions intentionally make a controlled demonstration. In real surveillance,
A&E waits have many causes, lags vary, wastewater depends on sampling/reporting effects,
and mobility indices need their own validated interpretation.

## 2. Preprocessing and baseline

[preprocess.py](../engine/preprocess.py) averages multiple readings into one row per
zone per calendar day and aligns zones on a common daily range. Missing values are
forward-filled for at most two consecutive days; later values in a longer gap remain
missing. This is backward-looking filling, never interpolation from future readings.

Floor wastewater at `DL = 1,000 copies/litre`:

```text
W_floor(t) = max(W(t), DL)
y(t)       = log(W_floor(t))                       raw log wastewater
x(t)       = log(mean(W_floor(t-2), W_floor(t-1), W_floor(t)))
```

Notice that `x` is the **log of an arithmetic mean**, not the mean of logs.
It requires all three readings; windows containing missing values remain unavailable.
We use smoothed `x` for level scoring and raw `y` for the growth fit.

For each zone, [scoring.py](../engine/scoring.py) defines baseline days
**t-17 through t-4 inclusive**, a 14-day window:

```text
mu_x, sd_x = mean and sample SD of baseline x
mu_y       = mean of baseline raw y
mu_E, sd_E = mean and sample SD of baseline ER
```

Only days where `x`, `y` and `ER` are all available contribute; at least 10 are needed.
Sample SD uses `ddof=1`. The gap stops the most recent rise immediately contaminating
its own comparison window, but it cannot eliminate every longer-outbreak bias.

With a full series, first scoring is at index 19: baseline `x(t-17)` needs two
earlier raw readings, so 20 daily rows are required.

## 3. Normalisation and risk score

Convert wastewater and A&E to z-scores relative to the zone's baseline:

```text
z_W = (x(t)  - mu_x) / max(sd_x, 0.3 / sqrt(3))
z_E = (ER(t) - mu_E) / max(sd_E, 5)
```

The SD floors prevent a coincidentally quiet baseline making ordinary variation look
extreme. The wastewater floor, approximately 0.173, is a small-noise approximation
for the log noise of a three-day mean; the A&E floor is 5 minutes.
These floors match the synthetic noise model, not measured sensor uncertainty.

The logistic transform and weighted sum are:

```text
s(z) = 1 / (1 + exp(-(z - 2)))
M    = mobility_density_score / 100

wastewater_points = 50 * s(z_W)
er_points         = 35 * s(z_E)
mobility_points   = 15 * M

score = clip(wastewater_points + er_points + mobility_points, 0, 100)
```

The logistic is centred at z=2: `s(0)` is about 0.119, `s(2)=0.5` and `s(4)` is
about 0.881. It bounds each signal rather than letting a very large z-score dominate.

`score_contributions()` provides the weighted points and `combine()` sums/clips them.
Both current and forecast scoring reuse this implementation.

Implications:

- **50% / 35% / 15% are maximum weights**, not the actual contributions on every day.
- A clean baseline does not score zero: both logistic terms have positive values.
- Mobility is added directly; it is not z-scored against its own baseline.
- Wastewater and mobility together contribute at most 65 points for an index in
  0-100. Reaching 80 also needs an elevated **current or projected** A&E component;
  this need not mean observed A&E is already high when an early alert opens.
- The score is neither an infection probability nor a predicted case count.

The selected-area UI shows observed inputs and these score points. Largest-remainder
rounding keeps displayed whole-number components equal to the displayed rounded
total; the engine and bar widths retain their unrounded values.

## 4. Forecasting 48 hours ahead

### Growth fit

[forecast.py](../engine/forecast.py) fits ordinary least squares to raw `y` over
the last seven days, t-6 through t. Missing `y` values are omitted; at least five
of the seven days are required.

For valid day indices `d_i` and observations `y_i`:

```text
d_bar  = mean(d_i)
y_bar  = mean(y_i)
S_dd   = sum((d_i - d_bar)^2)
r_hat  = sum((d_i - d_bar) * (y_i - y_bar)) / S_dd
y_hat(d) = y_bar + r_hat * (d - d_bar)

s2   = sum((y_i - y_hat(d_i))^2) / (n - 2)
se_r = sqrt(s2 / S_dd)
doubling_days = ln(2) / r_hat, only when r_hat > 0
```

With all seven days, centred indices are -3 through +3, `S_dd=28`, and residual
degrees of freedom are 5. With missing days, the code recalculates the centre and
denominator from the valid indices.

Raw logs avoid the overlapping-error correlation introduced by three-day moving
means. The textbook standard-error interpretation still relies on model assumptions:
forward-filled observations, for example, do not provide independent new measurements.
The doubling estimate describes wastewater growth, not clinical case doubling.

### Projected wastewater

With horizon `H=2`:

```text
x_hat(t+H) = x(t) + H * r_hat
```

This assumes recent log growth continues; it is not an observed future measurement.

### Lagged A&E projection

The generator's A&E lag is `L=4` days, so ER at `t+2` is modelled as depending on
wastewater at `t-2`. The fitted-line estimator ("V5") is:

```text
source_day    = t + H - L
ER_hat(t+H)   = mu_E + BETA_ER * (y_hat(source_day) - mu_y)
BETA_ER       = 20
```

With all seven days, `d_bar=t-3`, so `y_hat(t-2)=y_bar+r_hat*1`.
The baseline `mu_y` is the raw-log mean, not the smoothed mean.

Why use a fitted value rather than a three-day mean at t-2? The trailing mean lags
about a day under sustained exponential growth. Under a straight-line, independent
noise model the fitted mean at centred day +1 has SD
`0.3*sqrt(1/7 + 1/28)`, about 0.127, versus approximately 0.173 for the smoothing floor.
This is an estimator comparison, not a forecast confidence interval.

The constraints `H <= L` and `L-H <= fit_days-1` place the source day within the
observed fit window. No future rows are needed. However, forecasting ER still depends
on the assumed lag/coupling and is not "known future hospital pressure".

**Onset bias:** during the first six days of growth, the seven-day line can straddle
the flat-to-rising kink. At the source day the fitted estimate can be biased upwards;
once the full window is within sustained growth, that particular kink disappears.
This contributes to measured lead time and must not be sold as clinical foresight.

### Projected score

```text
projected_z_W = (x_hat(t+2)  - mu_x) / max(sd_x, 0.3/sqrt(3))
projected_z_E = (ER_hat(t+2) - mu_E) / max(sd_E, 5)
projected_score = combine(projected_z_W, projected_z_E, M)
```

The forecast uses the same baseline, floors, weights and mobility index as the current
score. It does not project new mobility behaviour.

## 5. Alert status and baseline freezing

[status.py](../engine/status.py) replays each zone's days in chronological order.
Outputs are derived from data through the requested as-of date, not from stored
knowledge of an injected outbreak.

| Status | Rule |
|---|---|
| `INSUFFICIENT_DATA` | No usable baseline or growth fit, warm-up, or a required current input is missing |
| `CRITICAL` entry | `projected_score >= 80` AND `r_hat - 2 * se_r > 0` |
| `CRITICAL` hold | Stay critical until BOTH `current_score < 70` AND the entry condition is false |
| `ELEVATED` | When not held/entering critical, `current_score > 40` |
| `SAFE` | Otherwise; displayed as "Normal" |

The growth gate asks that the fitted slope exceed two standard errors. For a complete
seven-day fit this is roughly a one-sided 5% test under independent Gaussian residuals;
it is **not a calibrated outbreak probability or exact universal significance guarantee**.
With daily log-noise SD 0.3, a typical `se_r` is near `0.3/sqrt(28)=0.057`, so slow
growth near 0.1/day can struggle to pass this gate.

At critical entry, the current pre-alert baseline is frozen. Otherwise an ongoing
outbreak could enter its own rolling baseline, lower its own z-scores and disappear
from the alert.

The exit day is evaluated against that frozen baseline. If the exit rule passes,
the freeze is cleared; the **following day** uses the live rolling window again.
A missing-data day reports insufficient data without discarding the replay's prior
critical/frozen state, so a data gap is not automatically evidence that an alert ended.

## 6. No-look-ahead and reproducibility

The backend ingests only observed days into SQLite. `replay_all()` cuts off later
rows before replay, and each replay step uses values at or before that day.
Tests corrupt future telemetry and add a future outbreak, then check unchanged
as-of outputs.

The seeded generator stores its noise, so injection does not redraw earlier readings.
Seed plus the ordered simulation action log reproduces deterministic outcomes.
Gemini prose, SMTP outcomes and asynchronous report events are outside that
mathematical reproducibility boundary; replay never sends email.

Engine source entry points:
[preprocess.py](../engine/preprocess.py), [scoring.py](../engine/scoring.py),
[forecast.py](../engine/forecast.py), [status.py](../engine/status.py).

## 7. Validation definitions and reproduction

The required benchmark in [test_required.py](../engine/tests/test_required.py)
uses 200 seeds, the current CSV roster and 42 days of data. Outbreak runs inject
`r=0.4/day` on index 28 into a seed-selected zone. This onset is one day later than
the dashboard's Run demo onset at index 27.
Clean runs use seeds 0-199; outbreak runs use seeds 10,000-10,199.

Definitions:

- **Clean zone-day:** a scored day without an injected outbreak, excluding warm-up.
- **Lead:** first day current score >=80 minus first CRITICAL day.
- **First warning:** first ELEVATED or CRITICAL day on/after onset.
- **k:** event day minus onset day.

Requirements:

1. Zero CRITICAL statuses in clean runs.
2. CRITICAL on/before the current-score crossing in at least 95% of seeds,
   with median lead at least two days; also report warning timing and lead spread.
3. No look-ahead.
4. No fading of the alert before onset +12 days in the tested outbreak scenarios.

To reproduce from the repository root after installing development dependencies:

```powershell
.\.venv\Scripts\python.exe -m pytest -s engine\tests\test_required.py
```

This suite is expected to include the known failing clean-data requirement below.
These are synthetic benchmark definitions, not precision/recall on real diagnoses.

## 8. Measured results

The following are the **previously recorded 36-ICB, 200-seed results**, not a new
clinical study or a claim that every test currently passes. Changing roster order,
generator parameters or noise changes the benchmark and requires remeasurement.

| Metric | Recorded result |
|---|---|
| False CRITICAL on clean data | **1 in 165,600 scored zone-days: FAILS the zero requirement** |
| ELEVATED on clean data | 5,165 of 165,600 zone-days, approximately 3.1% |
| CRITICAL on/before current score >=80 | 100% of outbreak seeds |
| Lead | Median 2 days; mean 2.245 days |
| Lead distribution | 0 days: 5 seeds; 1: 30; 2: 90; 3: 61; 4: 14 |
| First warning, median k | 2 days |
| First CRITICAL, median k | 4 days |
| Current score >=80, median k | 6 days |
| Alert hold requirement | No fade before onset +12 in the tested outbreak runs |

The zero-false-CRITICAL requirement is retained unchanged, not skipped or relaxed.
Earlier 42-ICB measurements are historical and not evidence for the current roster.

### Default presentation run

With seed 42, the current roster and Greater Manchester injected at day 27:

- CRITICAL on day 31, **2 October 2026**.
- At detection: current score about **54.8**, projected score about **81.8**,
  fitted wastewater doubling time about **2.7 days**.
- Current score reaches 80 on day 34, **5 October**: an observed **three-day lead**.

The fitted 2.7-day doubling estimate at onset differs from the generator's sustained
1.7-day doubling because the fit window still includes pre-growth days.
These dates depend on the default start date and run parameters.

### Slower growth

Exploratory results from the former 42-ICB roster found that many `r=0.1/day`
outbreaks never became critical in the short timeline. They are not current 36-ICB
performance figures. [lead_vs_r.py](../scripts/lead_vs_r.py) can remeasure growth-rate
sensitivity; a longer fit or an alternative detector is not implemented.

## 9. Interpretation and limitations

1. **Synthetic validation only.** The generator and detector share assumptions.
   Measured lead is relative to this system's own risk-score crossing, not the
   first clinical test, hospital admission or official outbreak declaration.
2. **A known false critical remains.** Even under these assumptions the strict
   clean-data requirement fails. Alert thresholds must not be silently tuned to
   hide that result.
3. **Matched calibration.** `BETA_ER=20` and a four-day lag match the generator.
   Real wastewater/A&E relationships vary by place, pathogen and service conditions.
4. **Nonspecific proxies.** Waiting times reflect staffing, demand and other illnesses;
   mobility does not establish transmission or identify a virus.
5. **Noise and reporting assumptions.** Real series can have autocorrelation,
   weekday effects, rainfall dilution, lab delays and missingness. OLS standard
   errors and logistic weights need validation on representative data.
6. **Onset and slow-growth behaviour.** The early kink can bias projections upwards,
   while the significance gate can miss slower rises.
7. **No spread model.** Independent per-zone injections do not simulate transmission
   networks or cross-ICB spread. Mobility is fixed rather than a changing movement feed.
8. **Approximate geography.** CSV coordinates and population estimates are demo metadata;
   map pins are not geographical boundaries.
9. **AI is downstream.** Gemini does not improve or validate statistical detection.
   Structured, length-limited prose can still contain unsupported interpretations.

Real use would require independent historical back-testing, calibrated false-alarm
and lead-time evaluation, data-quality controls, authorised escalation pathways and
public-health review. It would also require the production safeguards described in
[the system design](SPEC.md#deployment-constraints).
