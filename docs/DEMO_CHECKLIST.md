# Demo checklist: approved incident reports

All telemetry is synthetic. Every PDF and email must say this is an exercise.
See the [setup instructions](../README.md) and [talk track](DEMO_SCRIPT.md).

## Before presenting

- Configure `GEMINI_API_KEY`, an available `GEMINI_MODEL`, SMTP sender credentials and
  `ALERT_RECIPIENT` in the local `.env`. The current test recipient is
  `daeyad1@gmail.com`, not an official authority.
- Gmail needs an app password, not the normal account password.
- Start both servers, open http://localhost:5173 and verify the simulated-data badge.
- Optionally run the manual Gemini PDF smoke command from the README. It never emails.
- A real end-to-end send is a separate operator action: only click **Approve & send
  report** if you intend to email the configured recipient.
- Configure before starting: restarting the backend resets demo records.

## Run the demo

1. Click **Run demo**. It resets, injects a synthetic outbreak and plays.
2. Before detection, there is no incident card or "hidden from the system" step.
3. Around day 31, Greater Manchester becomes critical. The incident card displays a
   short summary, the test recipient and **Approve & send report** / **Dismiss**.
4. There are no stock transfers, map transfer arcs, rideshare actions or briefing steps.
5. Pause if useful. The clock does not stop for pending approval.
6. Explain that nothing is sent automatically, even if the operator waits.
7. Approve only when ready to send. Watch queued -> generating -> sending -> accepted.
8. Download the PDF. Check the exercise label, zone, detection date, measurements,
   executive summary, assessment, advisory actions and limitations.
9. Check the actual recipient inbox/spam folder; SMTP acceptance alone is not delivery.
10. Step to day 33 to show the lead band: the alert came before current risk reached 80.
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
