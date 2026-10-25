# The maths, from first principles

This document explains every number the system computes, in the order the engine
computes them, and then reports what we measured and what we have not shown.

**All data is synthetic.** Section 6 explains why that matters.

Every constant named here lives in `engine/config.py` (the maths) or `backend/config.py`
(the inventory and the agent). All windows are in **days**. "Today" is day `t`.

---

## 1. The signals

The system watches three numbers for each of England's 42 Integrated Care Boards (ICBs).
We call them "zones".

| Signal | Symbol | What it is | Why it helps |
|---|---|---|---|
| Wastewater viral load | `W(t)` | Virus copies per litre at the zone's treatment works | Infected people shed virus before they feel ill, so this moves first. |
| A&E waiting time | `ER(t)` | Average minutes waited in emergency departments | This is the clinical consequence. It follows the wastewater a few days later. |
| Mobility density | `M` | A 0–100 index of how much people mix, divided by 100 | Higher mixing means faster spread. It is a risk multiplier, not a detector. |

The synthetic generator (`engine/generator.py`) builds each zone like this:

```
log W_true(d) = log W_base + r · max(0, d − start_day)        (the outbreak, if any)
W(d)          = W_true(d) · exp(ε_d),     ε_d ~ Normal(0, 0.3)
ER(d)         = ER_base + 20 · (log W_true(d − 4) − log W_base) + ν_d,   ν_d ~ Normal(0, 5 min)
M             = constant per zone
```

The key points:

- Wastewater noise is **multiplicative**. A typical day is 30% above or below the true
  level, so we work with logs, where that noise becomes additive with standard
  deviation σ = 0.3.
- A&E responds to wastewater with a **lag of L = 4 days**. People get infected, shed
  virus, get ill and then arrive at hospital.
- An outbreak with growth rate `r` makes log wastewater rise by `r` per day. The load
  doubles every `ln 2 / r` days, which is 1.7 days at the demo's r = 0.4.

### Preprocessing (`engine/preprocess.py`)

1. **One row per zone per day.** A missing day is filled with the previous reading, for
   at most 2 days in a row. A longer gap stays missing, and the engine reports
   `INSUFFICIENT_DATA` rather than invent values.
2. **Detection limit.** A reading below `DETECTION_LIMIT` (1,000 copies/L) is
   indistinguishable from zero, so it is floored there. This also keeps `log(0)` away.
3. **Two versions of log wastewater:**
   - `y(t) = log(max(W(t), DL))` is the **raw** daily log.
   - `x(t) = log(mean of W over t−2, t−1, t)` is a **3-day smoothed** log.

We use `x` to decide how high the level is today, because averaging 3 days cuts the
noise. We use `y` to measure how fast it is growing, for reasons given in §3.

---

## 2. How unusual is today? z-scores against the zone's own baseline

Zones differ a lot. Baseline wastewater spans a factor of 10, and A&E waits range from
30 to 90 minutes. A single national threshold would be meaningless, so each zone is
compared with **its own recent normal**.

### The baseline window: days t−17 to t−4

For each zone we take the mean and standard deviation over the 14 days from t−17 to t−4:

```
μ_x, σ_x = mean and sample SD of x over days t−17 .. t−4
μ_E, σ_E = mean and sample SD of ER over the same days
```

**Why stop at t−4 and not at yesterday?** Suppose an outbreak started 3 days ago. If
the baseline included those 3 days, the rise would pull the baseline mean upwards and
partly hide itself. The 4-day gap keeps a fresh rise out of its own baseline.

### The z-scores

```
z_W = (x(t) − μ_x) / max(σ_x, SIGMA/√3)
z_E = (ER(t) − μ_E) / max(σ_E, ER_NOISE_SD)
```

A z-score answers one question: how many standard deviations above this zone's normal
is today?

### Why the denominators have floors

With only 14 days of data, a zone can by chance have an unusually calm fortnight. Its
σ comes out small, and an ordinary wobble then divides into a huge z-score, which is a
false alarm.

We know how noisy the measurements really are, so we never let σ drop below that noise:

- For `x`, the floor is **σ/√3 = 0.3/√3 ≈ 0.173**. The mean of 3 independent noisy
  days has its log-noise SD divided by √3 (a good approximation for noise this small).
- For ER, the floor is **5 minutes**, the known A&E measurement noise.

So a floor is a statement of the form "you cannot be more certain than your instrument".
The test `engine/tests/test_scoring.py::test_z_score_uses_floor` checks it.

---

## 3. From z-scores to one risk score

### The logistic squash

```
s(z) = 1 / (1 + exp(−(z − 2)))
```

This S-shaped curve turns any z into a number between 0 and 1. It is centred at z = 2,
"two standard deviations above normal":

| z | 0 | 1 | 2 | 3 | 4 | 6 |
|---|---|---|---|---|---|---|
| s(z) | 0.12 | 0.27 | 0.50 | 0.73 | 0.88 | 0.98 |

The squash does two jobs:

- **It caps each signal.** One absurd reading (z = 40) can't produce a score of 4,000.
- **It is steep where it matters.** It is most sensitive between z = 1 and z = 3, where
  "normal noise" turns into "something is happening".

### The weighted sum

```
score = 100 · (0.50 · s(z_W) + 0.35 · s(z_E) + 0.15 · M),   clipped to [0, 100]
```

`combine()` in `engine/scoring.py` is the only implementation of this formula. It is
reused for the forecast score.

- **Wastewater has the largest weight (0.50)** because it is the earliest signal.
- **A&E has 0.35** because it confirms that people are actually falling ill.
- **Mobility has 0.15** because it raises the stakes but detects nothing by itself.
  It is constant per zone in this demo.

Some useful consequences:

- A perfectly normal day (z = 0 for both signals) scores `100 · 0.85 · 0.12 + 15M`,
  which is about **10 + 15M**. That is 13 to 22, depending on the zone.
- **Wastewater alone can give at most 50 + 15M ≤ 65 points.** Reaching 80 needs A&E
  to rise as well. One noisy sensor can never trigger the red alert alone.
- The ceiling is 85 + 15M. That is why the demo zone levels off near 88.6.
- `ELEVATED` (amber) means **score > 40**.

---

## 4. Looking 48 hours ahead

Today's score reaches 80 only once hospitals are already under strain. The point of the
system is to act **before** that, so it forecasts the score two days ahead (H = 2).

### 4a. The growth rate: ordinary least squares on 7 days

We fit a straight line to the **raw** log wastewater `y` over the last 7 days (t−6 to
t). On a log scale, exponential growth is a straight line, and its slope is the growth
rate. With the days centred, d = −3, …, 3, so that Σd = 0 and Σd² = 28:

```
r_hat = Σ d · (y − ȳ) / Σ d²                    (slope: growth per day)
s²    = Σ residual² / (n − 2)                   (residual variance, 5 degrees of freedom)
se_r  = s / √(Σ d²) = s / √28                   (standard error of the slope)
doubling time = ln 2 / r_hat                    (shown only when r_hat > 0)
```

**Why fit raw `y` and not smoothed `x`?** The 3-day means overlap: x(t) and x(t−1)
share two of their three days, so their errors are correlated. The textbook formula
for `se_r` assumes independent errors. On `x` it would therefore understate the
uncertainty and make the system overconfident. Each raw `y` has independent noise, so
the formula is valid. `test_status.py::test_growth_fit_receives_raw_log_wastewater`
checks this choice, and `test_forecast.py::test_ols_recovers_slope_and_closed_form_se`
checks the closed form.

### 4b. Projected wastewater

```
x_hat(t+2) = x(t) + 2 · r_hat
```

This continues today's growth for two more days.

### 4c. Projected A&E: reading the future from the past (the "V5" estimator)

A&E on day t+2 is driven by wastewater on day (t+2) − 4 = **t−2**, which we have
**already observed**. The forecast is therefore not a guess about the future. It reads
a cause that has already happened:

```
ŷ(t−2)      = ȳ + r_hat · 1                     (the fitted line at day t−2, centred d = +1)
ER_hat(t+2) = μ_E + BETA_ER · (ŷ(t−2) − μ_y)
```

Here `μ_y` is the baseline mean of raw `y`, and `BETA_ER = 20` is the number of
minutes of A&E wait per unit of log wastewater.

**Why the fitted line and not just x(t−2)?** Phase 1 prototyped several estimators,
and this variant (V5) won.

- The 3-day mean x(t−2) averages days t−4 to t−2, so it lags by about a day. Its noise
  SD is 0.3/√3 ≈ 0.17.
- The fitted line at day t−2 has **no lag**. Its noise SD is
  `σ · √(1/7 + 1²/28) ≈ 0.3 × 0.42 ≈ 0.13`, which is lower.

**No look-ahead.** The estimate uses only data up to t. `config.py` asserts H ≤ L, so
day t+H−L has been observed, and it asserts that day lies inside the 7-day fit window.
Reading the line there is interpolation, not extrapolation.

**Known bias.** In the first few days of an outbreak (fewer than 6 days since onset),
the 7-day window straddles the moment growth began. A straight line through a "flat,
then rising" kink overshoots at d = +1, so `ER_hat` is biased **upwards**. The bias
vanishes once the whole window is inside the outbreak. In practice it adds a little
lead time. It doesn't affect clean zones, because a clean zone has no kink.

### 4d. The projected score

```
projected_score = combine(z of x_hat(t+2), z of ER_hat(t+2), M)
```

This uses the same baseline, floors and weights as today's score. The only difference
is the inputs.

---

## 5. Turning scores into a status

### The significance gate

A zone enters **CRITICAL** when **both** of these hold:

```
projected_score ≥ 80      AND      r_hat − 2 · se_r > 0
```

The second condition asks whether the growth is **statistically real**. With 7 points
(5 degrees of freedom), "slope more than two standard errors above zero" is roughly a
one-sided 5% test. Without it, a single noisy high reading could push the projection
over 80. With it, the line must be climbing convincingly across the week.

It has a cost. With σ = 0.3, se_r ≈ 0.3/√28 ≈ 0.057, so the gate needs `r_hat` above
about **0.11 per day** (doubling in about 6 days). A true r of 0.1 sits right on that
line: in a 40-seed spot check, the gate passed on only 20–57% of outbreak days. Slower outbreaks
are often never confirmed; see the lead-vs-r table in §8.

### Hysteresis: why an alert does not flicker

Once CRITICAL, a zone **stays** CRITICAL until both of these hold:

```
current score < 70      AND      the entry condition no longer holds
```

CRITICAL deliberately fires **before** the current score reaches 80; that is the whole
point. Suppose the exit rule were simply "the current score is below the entry level".
The day after the alert, the current score would still be in the 60s, and the alert
would switch off. The lower exit threshold (70) and the requirement that the forecast
has also calmed down make the alert stick. They also stop a zone hovering near the
line from turning red and green on alternate days. In operations, a flickering alarm
is worse than none.

### The baseline freeze

While a zone is CRITICAL, its baseline is **frozen** at the window t−17..t−4 from the
day it entered.

Without the freeze, the outbreak would slide into the baseline window about 4 days
after the alert. The baseline mean would rise, the z-scores would fall, and the
outbreak would "explain itself away". Freezing compares the zone with how it looked
**before** the outbreak. The baseline unfreezes on the day the zone exits CRITICAL.
`test_status.py::test_baseline_freezes_during_critical_and_unfreezes_after` checks this.

### The full rule table

| Status | Rule |
|---|---|
| `INSUFFICIENT_DATA` | Warm-up: fewer than 20 days of history, the baseline window has fewer than 10 usable days, or the fit has fewer than 5 of its 7 days. |
| `CRITICAL` | Enter: projected ≥ 80 **and** r_hat − 2·se_r > 0. Hold until current < 70 **and** the entry condition fails. |
| `ELEVATED` | Current score > 40. |
| `SAFE` (shown as "Normal") | Anything else. |

**Status is stateless.** It is computed by replaying every day in order, up to the
as-of date (`engine/status.py::replay_zone`). Nothing is stored between days except
what the replay itself derives. That makes the "no look-ahead" property easy to test:
we cut the data at the as-of date **before** replaying.

---

## 6. The autobalancer: moving stock

When a zone **transitions** into CRITICAL, a deterministic allocation runs inside the
same clock tick (`backend/agent/allocation.py`). Each zone has one supply hub, holding
PPE, antivirals and vaccines (item `k`). The hub was seeded at a per-capita level `ℓ_k`
times the population `P`, with a ±20% random jitter.

```
surge target   T_k   = 2.0 · ℓ_k · P_target               (an outbreak zone should hold 2× normal)
deficit        D_k   = max(0, T_k − S_target,k)
safety level   F_j,k = ceil(0.6 · ℓ_k · P_j)               (a donor never drops below 60% of normal)
surplus        U_j,k = max(0, S_j,k − F_j,k)
transfer       from donor j: min(remaining D_k, U_j,k)     for each item k
```

**Rules**

- **Who can donate.** Donors must be `SAFE` **right now**: an amber or red zone never
  gives stock away.
- **Order.** Donors are ranked by great-circle (haversine) distance from the target,
  with `zip_code` breaking ties so the order is fully deterministic.
- **How many.** At most 3 donors per alert. A donor with nothing to spare is skipped
  and doesn't use up a slot.
- **Same-tick alerts.** When several zones go CRITICAL on the same tick, the highest
  projected score is served first, with `zip_code` breaking ties.
- **Partial cover.** Part of a deficit can stay uncovered. The demo covers PPE 100%,
  antivirals 100% and vaccines 83%, and the event reports this.

**Invariants (tested)**

| Invariant | Test |
|---|---|
| Total national stock never changes; every unit leaving a donor arrives at the target. | `backend/tests/test_agent.py::test_conservation_and_safety_over_runs` |
| No donor ever ends below its safety level `F`. | same test |
| Exactly one allocation per CRITICAL entry (`agent_episodes.status_event_id` is `UNIQUE`). | `test_exactly_once_per_episode`, `test_rerun_same_transition_is_noop`, `test_exit_and_reentry_gives_two_episodes` |
| Same-tick order is deterministic. | `test_allocation.py::test_same_tick_ordering_is_deterministic`, `test_agent.py::test_same_tick_alerts_are_order_independent` |
| `min(deficit, surplus)` and the 3-donor cap. | `test_allocation.py::test_allocation_takes_min_of_deficit_and_surplus`, `test_distance_order_and_donor_cap` |

---

## 7. The language model, and the number check

After the tick commits, Claude may write a plain-English briefing in the background:
a headline, a rationale and up to 6 containment directives. It **never sets
quantities**. It receives the transfers that have already been computed, and its
output schema has no quantity fields.

Language models can still state numbers in prose, so every briefing, the rule-based
template included, must pass two checks (`backend/agent/briefing.py`):

1. **Schema.** Lengths, 1–6 directives, and known priorities and categories. Unknown
   fields, such as an attempt to add `"ppe_units"`, are dropped and logged, never read.
2. **The number check.** Every integer of 100 or more in the text must appear
   somewhere in the episode context the model was given. The model may **repeat** a
   computed quantity, but it cannot **invent** one. "We sent 999,999 PPE" is rejected
   (`test_llm.py::test_llm_failures_are_classified`), and so is a made-up population.

Small integers below 100 (days, "3 hubs", percentages) are allowed, because they are
too common to check this way.

If anything fails (no API key, a timeout, invalid JSON or an invented number), the
rule-based briefing stays on screen, and `agent_episodes.llm_status` records why.
Quantities are identical either way.

---

## 8. Measured results

Unless stated otherwise, each number comes from 200 random seeds of a scenario that
matches the demo: 42 zones, 28 days of history plus 14 future days, and an outbreak
with r = 0.4 starting on day 28 in a randomly chosen zone. Run
`.venv/bin/python -m pytest -s engine/tests/test_required.py` to print them.

| Claim | Number | Produced by |
|---|---|---|
| False red alerts on clean data | **0** CRITICAL in **193,200** clean zone-days | `test_required.py::test_no_critical_on_clean_zones` |
| False amber on clean data | 6,078 of 193,200 zone-days (**3.1%**), about 1 of the 42 zones on a typical day | same test |
| Red alert before the current score hits 80 | **100%** of seeds, on or before the crossing (test requires ≥ 95%) | `test_critical_leads_current_score_crossing` |
| Lead time (crossing day − alert day) | median **2 days**, mean **2.25** | same test |
| Spread of the lead | 0 days: 2 · 1: 33 · 2: 94 · 3: 58 · 4: 10 · 5: 3 seeds | same test |
| First amber or red, days after onset | median **2** | same test |
| First red (CRITICAL), days after onset | median **4** | same test |
| Current score ≥ 80, days after onset | median **6** | same test |
| Alert holds | never fades before onset + 12 days | `test_alert_holds_until_onset_plus_12` |
| No look-ahead | Corrupting every row after the as-of date, and adding a second outbreak there, changes nothing | `test_no_look_ahead` |
| The demo run (seed 42, Greater Manchester, r = 0.4) | Alert on **2 Oct** (forecast 82.7, current 62.1, doubling 2.1 days); current score passes 80 on **4 Oct**: a **2-day** lead | Replayed step by step through the API; `frontend/e2e/demo.spec.ts` checks that the lead caption appears |
| Reproducibility | State is a pure function of the seed plus the ordered action log | `backend/tests/test_invariants.py::test_reproducible_from_seed_and_actions`, `test_agent.py::test_reproducibility_with_agent` |
| The past never changes | Injecting a spike only alters days from today onwards | `test_invariants.py::test_trigger_changes_only_future` |

### Lead time against growth rate

Measured with `scripts/lead_vs_r.py`, which uses the same 200 seeds and the same
demo-length timeline as the test above (the r = 0.4 row reproduces it exactly).
"k" is days since onset.

| r (per day) | Doubling | Median lead | Mean lead | Range | Alert on or before 80 | Median k: amber / red / 80 | Runs with no red alert |
|---|---|---|---|---|---|---|---|
| 0.1 | 6.9 days | 1 | 0.76 | −3 to 4 | 84.7% | 6 / 10 / 11 | **121 of 200** |
| 0.2 | 3.5 days | 2 | 1.68 | −2 to 6 | 95.0% | 3 / 6 / 8 | 0 |
| 0.3 | 2.3 days | 2 | 1.93 | 0 to 5 | 100% | 3 / 5 / 7 | 0 |
| 0.4 | 1.7 days | 2 | 2.25 | 0 to 5 | 100% | 2 / 4 / 6 | 0 |
| 0.6 | 1.2 days | 3 | 2.48 | 0 to 4 | 100% | 2 / 3 / 6 | 0 |

The lead statistics cover only the runs where both the alert and the crossing happened
within the 14 days. At r = 0.2, 1 run never reached 80. At r = 0.1, 124 runs never
reached 80. Giving slow outbreaks 30 days (`--days-after-onset 30`) changes little:
at r = 0.1, 104 of 200 runs still never go red.

---

## 9. Limitations (honest)

1. **The data is synthetic.** The generator and the detector were written by the same
   team, from the same model of the world: log-normal wastewater noise, a clean 4-day
   A&E lag and a linear log relationship. Real data has:
   - day-of-week effects and rainfall dilution;
   - lab batch effects and reporting delays;
   - A&E waits driven by many things besides one pathogen.

   The 0-false-alarm and 2-day-lead figures are properties of the method **on data that
   matches its assumptions**.
2. **`BETA_ER = 20` is matched to the generator**, which uses exactly 20. In reality the
   wastewater-to-A&E coupling would differ by pathogen and by zone, and it would have
   to be estimated (for example, by regressing ER on lagged log wastewater during past
   seasons). A wrong `BETA_ER` biases the projected A&E component: too high gives
   earlier, more nervous alerts, and too low gives later ones.
3. **The 4-day lag is known exactly here.** A real lag is uncertain and varies by
   pathogen.
4. **Early-outbreak fit bias.** For the first ~6 days after onset, the straight-line
   fit overshoots the kink (§4c). This bias is upward and helps lead time, but part of
   the measured lead at r = 0.4 comes from it, not from "real" foresight.
5. **Slow outbreaks are detected late or not at all.** The significance gate requires
   r_hat > 2·se_r ≈ 0.11/day, so growth near or below that is often never confirmed
   with 7 days of noisy data. At r = 0.1, 121 of 200 runs never went red within 14
   days, although amber came at a median of 6 days. Lead time shrinks as r falls (see
   the table above). Options include a longer fit window for slow growth, or a
   CUSUM-style detector alongside, but neither is built.
6. **Amber false alarms are common by design.** About 3.1% of clean zone-days are amber,
   roughly one zone on any day. Amber means "look", not "act". Only red triggers the
   autobalancer.
7. **ICB coordinates and populations are approximate.** The pins sit at hand-placed
   centroids, the distances used for donor ranking are centroid to centroid, and each
   ICB has a single notional supply hub.
8. **No real-data validation yet.** The next step would be a back-test against
   historical wastewater and A&E series, measuring lead time and false-alarm rate on
   seasons whose outcome is known.
9. **Stock is not returned after an episode.** When a zone leaves CRITICAL, pooled rides
   are re-enabled, but transferred stock stays where it went. Over a long run, donors
   near repeated outbreaks drift down towards their safety floors. A real system would
   need a rebalancing step back to normal levels.
10. **Mobility is constant per zone.** In this demo it raises a zone's score level but
    never changes over time, so it contributes nothing to detection.
11. **One outbreak per zone at a time,** and noise that is independent from day to day
    and from zone to zone. Real outbreaks spread between neighbouring zones, and real
    noise is correlated.
