# Demo script: early warning to approved report

Use the [checklist](DEMO_CHECKLIST.md) first. All data and alerts are synthetic.

## 0:00 - The problem

"We monitor synthetic wastewater and A&E signals across England's health areas.
Wastewater can show a rise before hospital pressure becomes obvious. We forecast
risk 48 hours ahead so an operator can review a developing incident early."

Point to **Viral outbreak early warning** and the **Proof of concept** badge. Explain
that this presentation uses generated data, then click **Run demo**. The dashboard
shows assessment dates rather than simulation day counters.

## 0:30 - Detection

Greater Manchester turns amber and then red around day 31. Pause if useful.

"Today's risk is about 62, while the forecast is about 83. The alert also requires
statistically significant positive growth; it is not just a noisy high measurement.
The system sees only the telemetry observed so far, not our injected ground truth."

Point to the zone chart and the incident's short summary. No incident card is shown
before detection. The synthetic spike remains only a demo control/chart marker.

"These are viral outbreak risk indices out of 100, not infection probabilities or
confirmed cases. The inputs are wastewater viral load (50%), A&E waiting-time
pressure (35%), and mobility/crowding (15%). Viral doubling time describes the
wastewater signal, not the number of patients."

## 1:00 - Human-approved notification

"Here is the incident summary and the configured test recipient. Nothing goes out
automatically. Approval authorises Gemini to write a professional report, which we
render as a PDF and email. Dismiss sends nothing. The simulation keeps running while
the operator decides."

Only if an actual test email is intended, click **Approve & send report**.

"Gemini writes the assessment; the evidence table comes directly from the observed
data. The PDF separates facts from AI interpretation and prominently says this is
an exercise. Approval happens before generation, so this is not an operator-reviewed
version of the final AI prose."

Show queued, generating, sending and acceptance status, then download the PDF.
Explain that SMTP acceptance does not guarantee arrival; verify the recipient inbox.
There are no stock transfers or operational containment actions.

## 2:00 - Lead time and limitations

Step to day 33 and point to the lead caption.

"In this seeded example the alert arrived two days before current risk reached 80.
The engine's multi-seed validation is documented in the maths notes. This is a
synthetic statistical demo, not a clinical diagnosis or identification of a pathogen."

"Real deployment would require validated surveillance data, authentication, durable
delivery auditing, agreed authority routing and public-health governance. Today every
zone uses one configured test inbox."

## Questions

- **Does AI decide severity or quantities?** No. Statistical rules determine severity.
  AI only writes an advisory assessment; this workflow never moves stock.
- **What if Gemini or email fails?** The failure is visible. Definite failures can be
  retried; ambiguous SMTP acceptance cannot be retried blindly.
- **Can reset retract email?** No. It cancels stale generation before dispatch, not an
  email already handed to SMTP.
- **Does replay send again?** No. Action-log replay has external dispatch disabled.
