# Demo checklist: approved incident reports

All telemetry is synthetic. Every PDF and email must say this is an exercise.
See the [setup instructions](../README.md) and [talk track](DEMO_SCRIPT.md).

## Before presenting

- Configure `GEMINI_API_KEY`, an available `GEMINI_MODEL`, SMTP sender credentials and
  `ALERT_RECIPIENT` in the local `.env`. The current test recipient is
  `daeyad1@gmail.com`, not an official authority.
- Gmail needs an app password, not the normal account password.
- Start both servers, open http://localhost:5173 and verify **Viral outbreak early
  warning** appears beside the **BioSecure logo**, with no proof-of-concept badge. The header
  shows an assessment date, not a day counter.
- Optionally run the manual Gemini PDF smoke command from the README. It never emails.
- A real end-to-end send is a separate operator action: only click **Approve & send
  report** if you intend to email the configured recipient.
- Configure before starting: restarting the backend resets demo records.
- Verify the England overview says **Monitoring 36 NHS ICBs across England** and
  the map has 36 pins using the April 2026 roster. Restart the backend to
  reload changed zone metadata; resetting the clock alone does not reload the CSV.
- Disclose the known failing clean-data requirement: 1 false CRITICAL zone-day in
  165,600 zone-days across 200 seeds. Do not claim zero false alerts.

## Run the demo

1. Click **Run demo**. It resets, injects a synthetic outbreak and plays.
2. Before detection, there is no incident card or "hidden from the system" step.
3. Around day 31, Greater Manchester becomes critical. The incident card displays a
   short summary, the test recipient and **Approve & send report** / **Dismiss**.
4. There are no stock transfers, map transfer arcs, rideshare actions or briefing steps.
5. Pause if useful. The clock does not stop for pending approval.
6. Explain that nothing is sent automatically, even if the operator waits.
   The dashboard presents a PoC rather than repeating synthetic-data labels; explain
   to the audience that the data is generated. PDF and email exercise labels remain.
7. Approve only when ready to send. Watch queued -> generating -> sending -> accepted.
8. Download the PDF. Check the exercise label, zone, detection date, measurements,
   executive summary, assessment, advisory actions and limitations.
9. Check the actual recipient inbox/spam folder; SMTP acceptance alone is not delivery.
10. Step to day 34 (5 October) to show the lead band: in seed 42, the alert came
    three days before current risk reached 80.
11. Play to the end, then reset. Explain that reset clears reports and cannot recall an
    email already submitted.

## Failure and safety checks

- Missing Gemini/SMTP settings produce an actionable failed state, not a fake success.
- Invalid/truncated Gemini output never produces an emailed report.
- Definite generation/SMTP failures allow an explicit retry.
- If a PDF already exists, retry reuses it.
- An ambiguous SMTP interruption displays **Email delivery unconfirmed** with no retry
  button. Check the inbox or SMTP logs to avoid duplicates.
- Dismiss sends nothing. Re-approval/retry after acceptance is rejected.
- Reloading the browser preserves the pending decision and report status within a run.
- Simultaneous incidents retain separate episode ids and report progress.

## Controls

Space: play/pause; right arrow: step; R: reset confirmation; S: demo spike; ?: help.
Shortcuts do not fire while typing. The built-in map works offline; optional street
tiles fall back to it if unavailable. Reports and email still need network access.

## Explaining the insights

- **Outbreak risk now** is a 0–100 early-warning index, not an infection probability
  or confirmed case count. The 48-hour metric projects that same index ahead.
- The visible score weights are wastewater viral load (50%), A&E waiting-time
  pressure (35%), and mobility/crowding (15%). The A&E factor remains part of the
  score, but its individual wait-time statistic is not shown.
- **Viral doubling time** estimates doubling of wastewater viral levels, not cases.
  Slow positive trends retain their estimated doubling time; **Not rising** means
  zero/negative growth, and missing estimates show a dash.
- Alert captions describe observed status, not knowledge of an injected scenario.
  A high forecast alone is not sufficient: entry also requires statistically clear
  positive viral growth. Risk-score formulas and thresholds are unchanged.

## Responsive layout checks

- Resize from desktop to tablet/phone and back with an area selected and an incident
  awaiting approval. The date and controls must wrap without overlapping.
- Small/short windows stack the map above the panels and scroll vertically. Desktop
  panels scroll together so neither the chart nor approval actions get clipped.
- On phones only the selected area's name stays pinned, avoiding overlapping map
  labels. Hover another pin or tap it to see its name and full area details.
- Open help, speed, reset confirmation, spike selection and risk tooltips near screen
  edges. They must fit the viewport; long dialogs scroll internally.
- The timeline gives event labels separate rows and scrolls horizontally on narrow
  screens to keep its labels readable. Nearby chart markers also use separate rows.
- Run the mocked browser regression suite against a running frontend (no backend,
  Gemini requests or emails needed):
  ```powershell
  cd frontend
  $env:PLAYWRIGHT_BASE_URL = 'http://localhost:5173'
  npx playwright test responsive.spec.ts --project=chromium-720 --project=webkit-720
  ```
