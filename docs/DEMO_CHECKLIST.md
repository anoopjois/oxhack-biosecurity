# Demo checklist

All telemetry is synthetic. PDFs and emails must remain exercise-labelled.
Use the [README](../README.md) for installation/configuration and
[demo script](DEMO_SCRIPT.md) for the talk track.

## Before presenting

- Start the backend and frontend using the README. Verify the actual Vite URL;
  the default is http://localhost:5173/ with backend on port 8000.
- Check `/api/v1/health` and the overview's **Monitoring 36 NHS ICBs across England**.
  Coverage comes from the April 2026 [roster](../engine/zones.csv).
- Confirm the header says **Viral outbreak early warning**, with the logo and assessment
  date. There is no initial coach popup, synthetic-data badge or day counter.
  Explain to the audience that the data is generated.
- If demonstrating delivery, configure Gemini and SMTP **before startup** and agree
  an authorised recipient. Do not assume the example/default inbox is your current
  configuration or an official authority.
- Check the actual **Delivery address** on the incident before approving. Every area
  uses one configured recipient; the ICB name is not an automatic contact lookup.
- For Gmail use an app password. Set `SMTP_FROM` explicitly if it is blank.
- The default timeout is 600 seconds. If the app still reports 90, follow
  [environment precedence/restart troubleshooting](../README.md#why-a-saved-setting-may-not-appear).
- A manual Gemini smoke check is optional and paid; it writes a PDF but never emails.
- Save any existing reports first: backend restart, Reset and Run demo clear run data.
- Do not run real-backend e2e tests on a presentation run; they reset the simulation.
- Disclose the known false-critical benchmark failure; do not claim zero false alerts.

## Run through the dashboard

1. Click **Run demo**: reset, inject Greater Manchester at 0.4/day, play at one second/day.
2. Select an area. Confirm current risk, 48-hour risk, doubling estimate and history.
3. In overview, show **50% / 35% / 15%** factor weights. In a selected area, show
   wastewater copies/L, A&E wait with usual baseline, mobility index and score points.
   A&E is no longer a headline tile, but its reading is visible in the factor breakdown.
4. Before detection there is no incident card or "hidden from the system" step.
5. With default seed/start date, Greater Manchester becomes critical on 2 October,
   index 31: current about 54.8, forecast about 81.8.
6. Show the summary, intended ICB, delivery address and explicit approve/dismiss controls.
   The clock remains usable while a decision is pending.
7. Prefer **Dismiss** for a no-send demonstration. Approve only if both the paid request
   and email are intended; approval authorises dispatch before final AI text is seen.
8. For an approved send, explain queued -> generating -> sending -> accepted, with
   enough time allowed for a multi-minute provider call.
9. Download the PDF. Verify area/date, exercise label, evidence table, executive
   summary, assessment, brief proposed actions, limitations, model and delivery address.
10. Check the recipient's inbox/spam folder; SMTP acceptance alone is not delivery.
11. By 5 October, index 34, the default example shows a three-day lead relative to
    current risk reaching 80. Do not describe this as lead before clinical confirmation.
12. At the timeline end, play/step are disabled and Reset/Replay demo remain available.
    Reset cannot recall submitted email.

## Failure and state checks

- Missing/invalid Gemini or SMTP configuration fails visibly, never as fake success.
- Invalid, truncated or overlong Gemini JSON is rejected.
- Definite failures permit explicit retry; a saved PDF is reused.
- Ambiguous SMTP submission shows **Email delivery unconfirmed**, with retry disabled.
- Reapproval of an already-decided incident is rejected. Dismiss sends nothing.
- Browser reload retains current-run decisions and reports. A new run clears caches.
- Simultaneous incidents stay separated by zone and episode.
- Status changes, not injected ground truth, create alerts.
- No stock-transfer arcs, inventory transfers, rideshare actions or separate briefing
  steps appear; the inventory compatibility API is not an active dashboard feature.

## Controls and map

| Shortcut | Action |
|---|---|
| Space | Play/pause |
| Right arrow | Step |
| R | Reset confirmation |
| S | Open spike control |
| ? | Help |
| Escape | Close open controls |

Shortcuts do not fire while typing. The default vector map works without tile
network access; optional street tiles fall back to it. This does not make Gemini,
SMTP or the backend connection work offline.

## Responsive and visual checks

- Resize desktop -> tablet -> phone -> desktop, with a selected area and pending alert.
- Date, controls, headings and approval buttons must not overlap or become inaccessible.
- Small/short viewports stack the map above panels; desktop panels scroll.
- Selected/critical labels must fit the map; on phones only the selected name stays
  pinned. Hover/tap other pins for their names and details.
- Help, speed, reset, spike controls and tooltips must fit the viewport.
- Timeline/chart markers must remain distinguishable near each other and at edges.
- Verify light/dark themes and reduced-motion behaviour.
- The blank favicon is intentional; the bundled header logo is separate from its
  original source image at the repository root.

Mocked layout checks, against a running frontend, do not need the backend and cannot
approve real reports:

```powershell
Set-Location frontend
$env:PLAYWRIGHT_BASE_URL = 'http://localhost:5173'
npx playwright test responsive.spec.ts --project=chromium-720 --project=webkit-720
```

The full Playwright configuration has six projects: Chromium/WebKit at 1280x720,
1440x900 and 1920x1080. Layout tests additionally resize through phone/tablet widths.
Full real-backend demo tests reset state and dismiss notifications instead of approving.

## Claims to avoid

- "80 means an 80% outbreak probability."
- "Gemini detects the outbreak" or "we identified the pathogen."
- "This predicts diagnoses 48 hours in advance."
- "The ICB has been contacted" merely because its name appears on the card.
- "No false critical alerts" or clinical accuracy claims from synthetic benchmarks.
- "Approval includes a human review of the final generated prose."
- "Reset cancels or recalls an email already being submitted."
