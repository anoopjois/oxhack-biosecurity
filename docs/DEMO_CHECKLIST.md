# Demo walkthrough checklist

Use this before presenting. The talk track itself is in [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md),
and the numbers behind it are in [`MATHS.md`](MATHS.md).

**Keyboard shortcuts:** <kbd>Space</kbd> play/pause · <kbd>→</kbd> step ·
<kbd>R</kbd> reset (asks first) · <kbd>S</kbd> spike · <kbd>?</kbd> help & settings.
They never fire while a form field has focus.

Screenshots of each state are in `docs/figures/ui-*.png`.

## The one-click demo
1. ☐ On first load a card reads "Watch an outbreak unfold". Click **★ Run demo** (on the
   card or in the header). It resets, injects a hidden spike in Greater Manchester at
   r = 0.4, and plays at 1 s per simulated day.
2. ☐ After about 4 s (Fri 2 Oct, Day 31 of 41), Greater Manchester's ring turns **red and
   pulses**. The map flies in, and blue arcs draw from 3 nearby areas. Each arc is labelled
   with the distance, the quantities and "🛡 keeps 4.2 days of reserve".
3. ☐ **The human check.** The header reads "· waiting for approval" and the clock holds.
   The incident card shows **Stock move proposed** with a countdown ring: "Auto-approves in
   30 s unless someone objects".
   - Say: *"The AI never moves medical supplies on its own. It proposes, and a person can
     stop it. If nobody objects within 30 seconds it goes ahead, so it is safe and still
     fast."*
   - Point at the 🛡 line: *"And it doesn't just move the shortage. Every donor keeps at
     least 4.2 days of its normal use."*
   - Click **✓ Approve now** (or let the timer run out). The step reads "✓ Approved by
     operator" (or "Auto-approved: nobody objected within 30 s"), and the clock carries on.
4. ☐ Press <kbd>Space</kbd> to pause, then talk through the screen.
## Before the show (10 minutes out)
1. ☐ **Start it.** Run `./dev.sh`. It prints the backend and frontend URLs.
   - On a fresh machine, the first run also creates `.venv` and installs npm packages.
     Allow a few minutes, and do it before the session, not on venue wifi.
   - If `python3` is older than 3.10, use `PYTHON=python3.13 ./dev.sh`.
   - If port 8000 or 5173 is taken, set `BACKEND_PORT` / `FRONTEND_PORT` in `.env`.
2. ☐ **AI briefing or not?**
   - With `ANTHROPIC_API_KEY` in `.env`, briefings switch to **"AI briefing (Claude)"** a
     few seconds after the alert. Check the key first with
     `.venv/bin/python scripts/llm_smoke.py`.
   - Without a key (or with flaky wifi), the **"Rule-based briefing"** stays. The demo is
     identical otherwise. If unsure, leave the key out.
3. ☐ **Open the page.** Open http://localhost:5173 full-screen (F11) on the projector.
   The layout fits with nothing clipped at 1280×720, 1440×900 and 1920×1080, in Chrome
   and Safari.
4. ☐ **Dry run.** Do one dry run of the one-click demo below. Then press <kbd>R</kbd>
   and confirm, so the audience first sees Day 27 with the coach card.
   - To see the coach card again after dismissing it, reload the page.
5. ☐ **Clean up the screen.** Close other tabs, mute notifications, and set display
   sleep to "never".

## The one-click demo (synced to the talk track)
With the default seed (42), the run is the same every time:

| Time after click | Day | What you should see |
|---|---|---|
| 0 s | 27 · Mon 28 Sep | The incident card appears, marked **WATCHING**, with a greyed step: "Simulated spike · hidden from the system". |
| ~3 s | 30 · Thu 1 Oct | Greater Manchester's ring turns amber. |
| **~4 s** | **31 · Fri 2 Oct** | **Red** and pulsing; the camera flies in; 3 arcs. **Press <kbd>Space</kbd>.** |
| (step) | 33 · Sun 4 Oct | Risk now is 87; the lead caption says **2 days**. |
| ~14 s | 41 · Mon 12 Oct | Timeline ends. |

1. ☐ On first load, a card reads "Watch an outbreak unfold". Click **★ Run demo** (on
   the card or in the header). It resets, injects a hidden spike in Greater Manchester
   at r = 0.4, and plays at 1 s per simulated day.
2. ☐ **Timeline bar** (bottom): "Recorded history" is shaded up to the "Today" cursor,
   and a **Spike** diamond sits at 28 Sep.
3. ☐ **At Day 31 (Fri 2 Oct)**, press <kbd>Space</kbd>. You should see:
   - Greater Manchester's ring red and pulsing; the legend reads Critical 1;
   - blue arcs from **Cheshire and Merseyside (37 km)**, **West Yorkshire (48 km)** and
     **Lancashire and South Cumbria (57 km)**, each labelled with the quantities sent;
   - the zone card: Risk now **62**, Risk in 48h **83** (red), Doubling **2.1** days,
     A&E wait 69 min (usual 64);
   - an **Alert raised** marker on the timeline.
4. ☐ **The incident card reads, top to bottom:**
   - Detected · 2 Oct · forecast 83, virus doubling every 2.1 days;
   - Stock moved · PPE 54k → 116k, Antivirals 17k → 29k, Vaccines 24k → 52k;
   - Briefing · "Rule-based briefing" (or "AI briefing (Claude)");
   - Containment · Pooled rideshare paused within 25 km until 9 Oct.
5. ☐ **The arcs fade after 20 s.** Click **Show on map** in the "Stock moved" step to
   draw them again.
6. ☐ Press <kbd>→</kbd> twice (Day 33, Sun 4 Oct). You should see:
   - the caption "⚡ Alert raised **2 days** before the risk score reached 80";
   - a shaded lead band on the chart;
   - **Would have hit 80** on the timeline.
7. ☐ Press <kbd>Space</kbd> to play to the end, or stop there.

## Full walkthrough
1. ☐ **Header:**
   - "SIMULATED DATA", "Mon 28 Sep 2026", "Day 27 of 41".
   - One blue button: **★ Run demo**.
   - A quiet group of Play, Step, "1s / day", ↺; plus "⚠ Simulate spike" and "?".
2. ☐ **Map:** only England, on a calm built-in map.
   - 42 small rings, all muted green ("Normal"); a few city names for orientation.
   - The legend reads Critical 0 · Elevated 0 · Normal 42.
   - You can't pan off to Europe.
3. ☐ **Overview:** the right panel says "All 42 areas normal". Hover or click the **?**
   next to "risk score" for the two-sentence explanation.
4. ☐ **Zone panel:** click any ring. It shows Risk now, Risk in 48h, Doubling and A&E wait
   (with "usual"), each with a **?**, plus the chart.
5. ☐ **Spike:** press <kbd>S</kbd>, then click Greater Manchester on the map; the dropdown
   updates. Keep r = 0.4 ("doubles every 1.7 days") and click **Inject spike**.
   - An incident card appears, marked **WATCHING**.
   - Its first step, "Simulated spike · hidden from the system", is greyed and dashed:
     only the audience knows about it.
   - The map doesn't change yet. That's correct: the spike only affects future days.
6. ☐ **Rising:** press <kbd>→</kbd> 2–3 times.
   - Greater Manchester's ring eases to amber.
   - The chart's dashed blue forecast climbs above the black "Risk now" line.
   - The caption reads "Risk is rising. No alert yet…".
7. ☐ **The CRITICAL tick:** keep pressing <kbd>→</kbd>. Around 2 Oct, in one step:
   - ☐ the ring turns red and pulses; the camera flies in; 3 arcs draw into Greater Manchester;
   - ☐ the incident card fills in: Detected → **Stock move proposed** ("PPE 54k → 116k…",
     the 🛡 donor-reserve line and the approval countdown) → Briefing ("Rule-based
     briefing") → Containment ("Pooled rideshare paused…");
   - ☐ **Step** is greyed out ("Waiting for a decision on the proposed stock move"). Click
     **✓ Approve now**: the step becomes "Stock moved · ✓ Approved by operator";
   - ☐ the chart shows **Spike** and **Alert** markers, and the timeline shows "Alert raised".
8. ☐ **Details:** in the card, click **Details** for the stock table (each donor, its
   distance and its reserve after giving), and **Read rationale & 5 actions** for the briefing, with
   IMMEDIATE / 24H / 72H badges.
9. ☐ **Lead time:** step 2–3 more days. The caption reads "⚡ Alert raised **2 days** before
   the risk score reached 80", with a shaded band on the chart. The timeline gains
   "Would have hit 80".
10. ☐ **Play to the end:** choose **0.5 s per day** from the speed menu, then press
    <kbd>Space</kbd>.
    - The clock stops at Day 41, and a bar reads "Timeline ended on 12 Oct · ↺ Reset ·
      ★ Replay demo".
    - Hovering a greyed control explains why it's disabled.
    - After about 20 s the arcs fade and the map flies back to England.
11. ☐ **Reload mid-demo:** the page comes back in the same state, and the arcs do **not**
    replay.
12. ☐ **Reset:** press <kbd>R</kbd>, then confirm. Day 27, all rings green, and
    "No incidents yet".
13. ☐ **Street map:** open **?** → Map style → "Street map (online, greyscale)". You get
    greyscale OpenStreetMap tiles at a slightly wider view, with no seams.
14. ☐ **Offline:** turn wifi off with the street map selected and reload. Within about
    4 s, "Offline: using the built-in map" appears, and everything still works. The
    default built-in map never needs the network.
15. ☐ **Raw log:** **?** → "Show the raw event log instead of incident cards" shows the
    event list, with its own filter. Switch it back.
16. ☐ **(Optional, needs an API key)** Put `ANTHROPIC_API_KEY` in `.env` and restart
    `./dev.sh`. Repeat step 7. A few seconds later the briefing switches in place to
    **"AI briefing (Claude)"**, marked "updated". `scripts/llm_smoke.py` tests the key on
    its own.
17. ☐ **Override:** reset, inject a spike and step to CRITICAL, then click **Override**.
    The step reads "Stock move overridden": no stock moved, the arcs clear, and the clock
    can run on.
18. ☐ **Zoom:** use **+** / **−** at the map's top-left to zoom by whole levels, and **⤢**
    to return to all of England.
19. ☐ **Dark mode:** click the ◐ button next to **?**: Auto → ☀ Light → ☾ Dark. The map,
    chart and cards all switch, and the choice is remembered on reload. It is also in
    **?** → Theme.
20. ☐ **Projector check:** from the back of the room, the date, status chips, card steps,
    arc labels and the timeline are readable. Red only ever means CRITICAL.
