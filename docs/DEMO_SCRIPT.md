# Demo script: viral outbreak early warning

Use the [checklist](DEMO_CHECKLIST.md) first. This is a synthetic-data demonstration.
Keep [the maths and limitations](MATHS.md) available for questions.

## Opening: what problem does it address?

> BioSecure brings together wastewater viral levels, A&E pressure and mobility to
> highlight developing viral-outbreak risk across England's 36 NHS ICBs. It projects
> a risk index 48 hours ahead so a person can review the evidence and prepare earlier.
> Today's demonstration uses generated data, not a live NHS surveillance feed.

Point to **Viral outbreak early warning** beside the logo and the coverage count.
Show the overview weights: wastewater 50%, A&E 35%, mobility/crowding 15%.
Explain that an index out of 100 is not an infection probability or confirmed cases.

## Start the run and inspect an area

Click **Run demo**, then pause if useful. This resets the run, injects Greater
Manchester at `r=0.4/day` and starts one simulated day per second.

> In a selected area we can inspect the actual factor readings and how many score
> points each contributes. Wastewater and A&E are compared with the area's recent
> baseline. Mobility is a stable crowding index in this model, not a changing feed.

Show the current and 48-hour forecast lines and the wastewater doubling estimate.
Clarify that doubling describes the wastewater signal, not patient numbers.
The injected-surge marker is presenter ground truth, not detector knowledge.

## Detection

With default seed 42, start date and roster, Greater Manchester becomes critical
on **2 October 2026**, index 31. Pause to discuss the incident.

> Current risk is about 55 while the forecast is about 82. The alert also needs
> positive growth beyond two fitted standard errors. The detector uses only the
> telemetry observed so far, not our injected outbreak labels or future rows.

Point to the incident summary. Explain Normal/Elevated/Critical and that amber
means monitor unusual signals, not "confirmed outbreak". No incident card opens
merely because the presenter injected a spike.

## Human-approved ICB situation report

Show **Intended authority**, **Delivery address**, **Approve & send report** and
**Dismiss**.

> The affected ICB is the intended audience for NHS preparedness. UKHSA and local
> public health would be partners in outbreak assessment. This demonstrator sends
> only to the delivery address shown; it does not look up or notify those teams.
> Nothing is emailed automatically, and pending approval does not stop the clock.

**Default to Dismiss unless an authorised recipient and an actual send are agreed.**
If demonstrating delivery, approve only with the operator's intention to make a
paid Gemini request and send the email.

> Approval asks Gemini for a concise situation report and authorises email dispatch.
> The measured evidence table is rendered from stored data. Gemini adds an advisory
> assessment and three or four proposed next steps, within a 350-word narrative:
> who should verify signals, liaise with public health and review NHS readiness.

Explain that approval happens **before generation**, not after a final-text preview.
Generation can take minutes; do not promise completion during a short presentation.
Show progress or an already-downloaded approved exercise report if available.
SMTP acceptance is not confirmed inbox delivery.

The PDF/email are exercise-labelled. No stock moves, clinical orders, rideshare
restrictions or separate briefing steps occur.

## Lead time

Step to **5 October**, index 34, when current risk reaches 80 in the default run:

> In this seeded example, the alert arrived three days before the observed risk index
> reached 80. That is lead relative to our score threshold, not a demonstrated
> three-day lead before clinical diagnoses.

The forecast horizon is two days, but a threshold-based alert lead can differ from
two days; these are different measurements.

## Close: evidence and limitations

> In the recorded 200-seed benchmark, median alert lead was two days and alerts were
> on or before the score crossing in all seeds. However, the clean-data benchmark
> found one false critical zone-day in 165,600 scored zone-days. Our strict zero-false
> critical requirement therefore remains failing.

> This is a proof of concept. Real deployment needs validated surveillance feeds,
> clinical/public-health calibration, authorised recipient routing, access controls,
> durable delivery auditing and operational governance.

Use [the recorded results](MATHS.md#8-measured-results), not older screenshots or
former 42-ICB statistics. Reset ends the demo but cannot recall submitted email.

## Short answers

- **Does Gemini predict the outbreak?** No. Statistical rules produce the index,
  forecast and status; Gemini writes the downstream report.
- **Does Critical confirm a virus or an outbreak?** No. It flags review of a high
  forecast plus a growing wastewater signal.
- **Who receives it?** Only the configured address captured when that incident opened.
  The named ICB is the intended authority, not proof of delivery to an official team.
- **What if generation/email fails?** The error is visible. Definite failures permit
  explicit retry; ambiguous SMTP submission does not.
- **Can I change settings live?** No. Restart after configuration changes and beware
  terminal overrides. See [configuration troubleshooting](../README.md#why-a-saved-setting-may-not-appear).
- **Does replay email again?** No. Simulation action-log replay disables dispatch.
