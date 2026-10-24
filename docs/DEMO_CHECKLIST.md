# Demo walkthrough checklist

**Setup**
- Run `./dev.sh`. On a fresh clone, use `PYTHON=python3.13 ./dev.sh`.
- Open http://localhost:5173 full-screen (F11) on the projector, or at 1920×1080.
- At 1280×720 the layout still works, and the inventory panel becomes a table.

**Keyboard shortcuts:** <kbd>Space</kbd> play/pause · <kbd>→</kbd> step ·
<kbd>R</kbd> reset (asks first) · <kbd>S</kbd> spike dialog · <kbd>?</kbd> help.
They don't fire while a form field has focus.

## The one-click demo
1. ☐ Click **★ Run demo**. It resets, injects a spike in Greater Manchester at r = 0.4,
   and plays at 1 s per simulated day. The Greater Manchester panel opens on the right.
2. ☐ After about 4 s (around Fri 2 Oct, Day 31), Greater Manchester turns **red and pulses**.
   The map flies in, and blue arcs draw from 3 nearby hubs into Greater Manchester, each
   labelled with the quantities sent.
3. ☐ Press <kbd>Space</kbd> to pause, then talk through the screen.

## Full walkthrough
1. ☐ **Header:** "SIMULATED DATA", "Mon 28 Sep 2026", "Day 27 / 41", and the Reset, Play,
   Step, Speed, Run demo, Simulate Pathogen Spike and ? buttons.
2. ☐ **Map:** England with 42 pins, bigger for bigger populations (Greater Manchester and
   North East are large, Shropshire is small).
   - The legend counts add up to 42.
   - Almost all are green; perhaps 1–2 are amber, with their names shown.
3. ☐ **Zone panel:** hover a pin and its name appears. Click it and the panel shows status,
   risk score, projected score, doubling time and ER wait against baseline. The chart sits
   well below the dashed 80 line.
4. ☐ **Spike dialog:** press <kbd>S</kbd> (or the red button), then click Greater Manchester
   on the map; the dropdown updates.
   - r stays at 0.4 ("doubles every 1.7 days").
   - Click **Inject spike**. The feed shows "Simulated pathogen spike in Greater Manchester".
   - The map does **not** change yet. That's correct: the spike only affects future days.
5. ☐ **Rising:** press <kbd>→</kbd> 2–3 times. Greater Manchester's chart starts rising, with
   the orange projected line above the blue current line. It may turn amber.
6. ☐ **The CRITICAL tick:** keep pressing <kbd>→</kbd>. Around 2 Oct (Day 31), in a single step:
   - ☐ the Greater Manchester pin turns red and pulses;
   - ☐ the map flies in and arcs animate from Cheshire, West Yorkshire and Lancashire;
   - ☐ the feed reads, top to bottom: status change → stock rerouted → rule-based briefing
     → containment ("[API MOCK] Pooled rides disabled…");
   - ☐ the inventory strip shows Greater Manchester's bars rising and the donors' falling.
7. ☐ **Briefing:** click **Rationale & N directives**. The rationale cites the projected
   score, growth rate, doubling time and ER against baseline. The directives carry
   IMMEDIATE, 24H and 72H badges. The source label reads "Rule-based briefing".
8. ☐ **Lead time:** step 2–3 more days. Under Greater Manchester's chart:
   "Alert raised **2 days** before the current score reached 80". The orange line crossed
   80 before the blue one, and the shaded band marks the lead.
9. ☐ **Play to the end:** choose **0.5s** and press <kbd>Space</kbd>. Days advance about twice
   a second. Greater Manchester stays red, and the clock stops at Day 41 with a
   "End of simulated timeline" card. After about 20 s the arcs fade and the map flies
   back to England.
10. ☐ **Feed filter:** tick **Show all** and the SAFE↔ELEVATED noise appears. Untick it and
    the noise is hidden again.
11. ☐ **Reset:** press <kbd>R</kbd>, then confirm. Day 27, all pins green, an empty feed, and
    "No transfers yet" in the inventory.
12. ☐ **Offline:** turn wifi off and reload.
    - Within about 4 s a banner reads "Map tiles unavailable: using offline outline", and
      England is drawn plainly with all 42 pins.
    - Run **★ Run demo**: everything works.
    - Use the Map **Online / Offline** toggle to switch back and forth.
13. ☐ **(Optional, needs an API key)** Put `ANTHROPIC_API_KEY` in `.env` and restart
    `./dev.sh`. Repeat step 6. A few seconds after the briefing card appears, it updates in
    place to **"AI briefing (Claude)"**. `scripts/llm_smoke.py` tests the key on its own.
14. ☐ **Projector check:** from the back of the room, the date, status chips, feed headlines
    and arc labels are readable. Red, amber and green are distinguishable, with the labels
    and the pulse as backup.
