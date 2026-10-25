# Demo script: 3 minutes

This talk track is timed to the **★ Run demo** button. It resets the simulation,
injects a hidden spike into Greater Manchester at r = 0.4 (doubling every 1.7 days)
and plays at **1 second per simulated day**. With the default seed (42), the run always
goes like this:

| Day | Date | What happens |
|---|---|---|
| 27 | Mon 28 Sep | Spike injected (invisible to the system) |
| 30 | Thu 1 Oct | Greater Manchester turns amber |
| **31** | **Fri 2 Oct** | **Red.** Forecast 83, risk now 62, doubling 2.1 days. Stock moves from Cheshire and Merseyside (37 km), West Yorkshire (48 km), and Lancashire and South Cumbria (57 km). |
| 33 | Sun 4 Oct | Risk now reaches 87: the alert came **2 days** earlier |
| 41 | Mon 12 Oct | Timeline ends |

The red tick arrives about **4 seconds** after you click. Keep a finger on
<kbd>Space</kbd>.

Before you start, run through [`DEMO_CHECKLIST.md`](DEMO_CHECKLIST.md) (setup and a
dry run).

---

## Talk track

### 0:00–0:25 · The problem (first-load screen, coach card showing)

> *Point at the map of England: 42 grey-green rings.*

"These are England's 42 health areas, the Integrated Care Boards. By the time a new
outbreak shows up as A&E queues, it's been spreading for a week, and the masks and
antivirals are in the wrong place. Wastewater is earlier: infected people shed virus
before they feel ill. We combine the two, forecast 48 hours ahead, and move stock
before hospitals fill up. Everything you're about to see is **simulated data**."

> *Point at the SIMULATED DATA badge.*

### 0:25–0:35 · Start it

> *Click **★ Run demo** on the coach card.*

"I've just hidden an outbreak in Greater Manchester. It doubles every 1.7 days."

> *Point at the incident card: the greyed, dashed step "Simulated spike · hidden from
> the system".*

"That grey step is only for you: the system can't see it. It only sees noisy
wastewater and A&E numbers, like the real world."

> *Point at the **timeline bar** along the bottom: the "Spike" diamond, and the "Today"
> cursor moving right.*

> *The ring turns amber, then **red and pulsing**. Blue arcs draw in. Press
> <kbd>Space</kbd> to pause.*

### 0:35–1:05 · The alert (zone card)

> *Point at the four stats at the top of the zone card.*

"It's the 2nd of October. The **risk score right now is 62**. That's not alarming yet,
and a threshold system would do nothing. But our **48-hour forecast is 83**, and the
virus in the wastewater is **doubling every 2.1 days**."

> *Point at the chart: the solid black "Risk now" line, the dashed blue "Forecast, 48
> hours ahead" line crossing the red 80 line, and the Spike and Alert pills.*

"The black line is today's risk. The blue dashed line is the forecast. The forecast has
crossed 80, and the growth is statistically significant, so we go red **now**, not when
the black line gets there."

### 1:05–1:50 · What the system did (incident card, top to bottom)

> *Point at each step of the incident card in turn.*

- **Detected:** "Flagged on 2 Oct, with a forecast of 83."
- **Stock moved:** "In the same tick, the autobalancer moved PPE, antivirals and
  vaccines into Greater Manchester. PPE goes from 54 thousand to 116 thousand."

  > *Point at the **arcs** on the map: each is labelled at the donor end with the
  > distance and the amounts sent. If they've faded (after 20 s), click **Show on map**
  > in the card.*

  "It only takes from the three nearest areas that are normal right now: Cheshire at
  37 km, West Yorkshire at 48, and Lancashire at 57. None of them goes below a safety
  floor of 60% of its normal stock. And the total stock in the country never changes:
  we move it, we don't invent it."
- **Briefing:** "A plain-English rationale and five actions, for a human to approve.
  This one is rule-based. With an API key, Claude rewrites it in place. But Claude never
  sets a quantity: any number it writes over 100 must match the computed allocation,
  or we throw it away."

  > *Optional: click **Read rationale & 5 actions** to show the IMMEDIATE / 24H / 72H
  > badges.*
- **Containment:** "And a containment lever: pooled rideshare is paused within 25 km
  for a week. Here that's a mock webhook."

### 1:50–2:15 · The lead-time callout

> *Press <kbd>→</kbd> twice, to Day 33, Sun 4 Oct.*

"Two days later, the risk score right now hits **87**. That's the moment a
conventional system would raise the alarm."

> *Point at the **lead caption** under the chart: "⚡ Alert raised 2 days before the risk
> score reached 80", and the shaded band on the chart. Then point at the timeline's new
> marker, "Would have hit 80".*

"We were **two days early**, and the stock was already there."

### 2:15–2:45 · Why you should believe it

"This isn't one lucky run. We ran 200 random outbreaks:

- The red alert came on or before the 80 crossing in **every one**, with a median lead
  of **2 days**.
- On clean data, 193,200 zone-days with no outbreak, we raised **zero** false red
  alerts.

And no machine learning: it's z-scores against each area's own baseline, a 7-day growth
fit with a significance test, and a forecast that reads A&E four days ahead from
wastewater we've already measured. Every formula is in `docs/MATHS.md`."

"To be honest about it: this is synthetic data, and slow outbreaks get less lead time.
The next step is back-testing on real wastewater and A&E series."

### 2:45–3:00 · Close

> *Press <kbd>Space</kbd> to let it run to the end, or stop here.*

"Wastewater tells us where an outbreak is going. We move the stock before the
hospitals feel it. Thank you."

---

## Recovering mid-demo

- **Missed the pause and it's past Day 31?** That's fine; the card and chart keep
  everything. If you're at Day 33 or later, the lead caption is already showing, so go
  straight to it.
- **The arcs have faded?** Click **Show on map** in the "Stock moved" step.
- **Anything odd?** Click **★ Run demo** again. It always resets first, and the run is
  identical every time.

---

## The 10 questions judges are most likely to ask

**1. Is any of this real data?**
No. Everything is synthetic, generated with known noise and a known 4-day lag between
wastewater and A&E. That lets us measure lead time and false alarms exactly, because we
know the ground truth. It also means the numbers are a best case. The next step is a
back-test on historical wastewater and A&E series.

**2. Did you tune the constants until the test passed?**
The thresholds (80 to enter, 70 to exit, 40 for amber) and the weights were set up
front. The noise floors equal the generator's noise levels. One constant is matched to
the generator: `BETA_ER = 20`, the A&E minutes per unit of log wastewater, because the
generator uses 20. On real data it would have to be estimated. That's in our
limitations.

**3. How many false alarms?**
Red: zero in 193,200 clean zone-days across 200 seeds. Amber: 3.1% of clean zone-days,
about one area on any given day. Amber means "keep an eye on it". Only red moves
stock.

**4. What about a slower outbreak?**
The lead shrinks. Median lead is 2 days for r = 0.2 to 0.4, and 3 days at r = 0.6. At
r = 0.1 (doubling every week), the 7-day fit often can't prove the growth is real, so
121 of 200 runs never go red within 14 days. They still go amber after a median of 6
days. The table is in `docs/MATHS.md` §8.

**5. Why not machine learning?**
We have no labelled real outbreaks to train on. Every decision also has to be explained
to a public-health official. The lead time comes from structure, not from a fitted
model: the A&E rise in two days is caused by wastewater we measured two days ago. A
z-score, a logistic squash and a least-squares slope are things you can check by hand.

**6. Where does the 2-day lead actually come from?**
Two places:
- The forecast extrapolates the wastewater growth.
- A&E lags wastewater by 4 days, so A&E in 48 hours is driven by wastewater from 2 days
  ago, which we've already seen.

We also know the early straight-line fit overshoots slightly at the very start of an
outbreak. That bias is upward and adds a little lead.

**7. Can the AI hallucinate quantities or send stock to the wrong place?**
No. Quantities are computed by deterministic code inside the clock tick, before Claude
is called. Claude only writes the rationale and the actions. Its output schema has no
quantity fields, and every number of 100 or more in its text must appear in the data
we gave it. If any check fails, we keep the rule-based briefing.

**8. Doesn't taking stock leave the donors exposed?**
Each donor keeps at least 60% of its normal per-capita stock. Only areas that are
currently normal can donate, and we use at most 3 per alert. One honest gap: stock
isn't returned when an episode ends, so a long run with repeated outbreaks would
slowly drain the donors.

**9. Why pause rideshare pooling?**
It stands in for a real, low-cost containment lever that reduces close contact. In
this demo it's a mock webhook with a 25 km radius and a 7-day review date. In a real
deployment, each directive would go to a human for approval.

**10. What would it take to deploy this?**
- Real feeds: national wastewater monitoring and NHS A&E data, both daily.
- Per-area calibration of `BETA_ER` and the lag.
- A back-test on past seasons, to measure real lead time and false-alarm rates.
- Real hub inventories, and a rule for returning stock afterwards.
- A human approval step before any transfer.

The engine is pure functions, so it can be pointed at a real data source without
changing the maths.
