"""Rule-based briefing: the rationale and directives written from the episode context.

Every number comes straight from the context (already rounded there), so the text always
passes the same number check as an LLM briefing. Each directive has an explicit rule.
"""

from backend import config


def _n(value: int) -> str:
    return f"{value:,}"


def _names(transfers: list[dict]) -> str:
    """ICB names contain "and", so list several hubs as "3 hubs (A; B; C)" to stay unambiguous."""
    names = [t["donor_name"] for t in transfers]
    return names[0] if len(names) == 1 else f"{len(names)} hubs ({'; '.join(names)})"


def _hubs(count: int) -> str:
    return "1 hub" if count == 1 else f"{count} hubs"


def build_template(ctx: dict) -> dict:
    zone, risk, er, alloc = ctx["zone"]["name"], ctx["risk"], ctx["er"], ctx["allocation"]
    transfers, moved, uncovered = alloc["transfers"], alloc["transferred"], alloc["uncovered"]
    deficit, cover = alloc["deficit"], alloc["coverage_pct"]
    any_deficit = any(deficit.values())
    any_uncovered = any(uncovered.values())
    approval = ctx["approval"]["required"]  # True: the stock moves once approved (or after the timeout)

    # Headline
    if transfers:
        stock_part = (f"surge stock {'proposed' if approval else 'dispatched'} from "
                      f"{_hubs(len(transfers))}")
    elif any_deficit:
        stock_part = "shortfall escalated to the national reserve"
    else:
        stock_part = "hub already at surge level"
    # CRITICAL requires r_hat - 2 SE > 0, so a doubling time exists; guard anyway.
    growth = (f"doubling every {risk['doubling_days']} days" if risk["doubling_days"]
              else "rising significantly")
    headline = f"{zone}: wastewater {growth}; {stock_part}"

    # Rationale
    sentences = [
        f"{zone} entered CRITICAL on {ctx['date_label']}. Its projected {risk['horizon_hours']}-hour "
        f"risk score is {risk['projected_score']} (current {risk['score']}).",
        f"Wastewater viral load is growing at {risk['growth_per_day']:.2f} per day (standard error "
        f"{risk['growth_se']:.2f}), {growth}, and the growth is statistically significant.",
        f"ER waits are {er['wait_mins']} minutes against a {er['baseline_mins']}-minute baseline. "
        f"Because hospital demand trails wastewater by about {er['lag_days']} days, further pressure "
        f"is already on its way.",
    ]
    if transfers:
        sentences.append(
            ("Stock is proposed toward a " if approval else "Stock was raised toward a ")
            + f"{alloc['surge_multiplier']:g}× surge level from "
            + ("the nearest SAFE hub" if len(transfers) == 1
               else f"the {len(transfers)} nearest SAFE hubs")
            + ", covering "
            f"{cover['ppe_units']}% of the PPE, {cover['antiviral_doses']}% of the antiviral and "
            f"{cover['vaccine_doses']}% of the vaccine shortfall. No donor "
            + ("would fall" if approval else "fell") + " below "
            f"{alloc['safety_pct']}% of its normal per-capita stock, which is "
            f"{alloc['reserve_floor_days']:g} days of normal use.")
        if approval:
            sentences.append(f"It moves once an operator approves, or automatically if nobody objects "
                             f"within {ctx['approval']['timeout_s']} seconds.")
    elif any_deficit:
        sentences.append("No SAFE hub within reach had stock above its safety level, so the full "
                         "shortfall has been escalated.")
    else:
        sentences.append(f"Hub stock already met the {alloc['surge_multiplier']:g}× surge level, so no "
                         f"transfers were needed.")
    rationale = " ".join(sentences)

    # Directives, most urgent first
    directives = [{
        "action": f"Suspend pooled rideshare across {zone}",
        "detail": f"Executed via the platform webhook within a {ctx['rideshare']['radius_km']} km radius; "
                  f"review on {ctx['rideshare']['review_label']}.",
        "priority": "immediate", "category": "mobility",
    }]
    if risk["doubling_days"] is not None and risk["doubling_days"] < config.FAST_DOUBLING_DAYS:
        directives.append({
            "action": "Activate A&E surge staffing",
            "detail": f"Wastewater is doubling every {risk['doubling_days']} days and ER waits are "
                      f"{er['wait_mins']} min against a {er['baseline_mins']}-min baseline.",
            "priority": "immediate", "category": "healthcare",
        })
    if moved["antiviral_doses"] > 0:
        senders = [t for t in transfers if t["antiviral_doses"] > 0]
        directives.append({
            "action": "Prioritise antivirals for frontline staff and over-65s",
            "detail": f"{_n(moved['antiviral_doses'])} doses "
                      + ("proposed from " if approval else "arriving from ") + f"{_names(senders)}.",
            "priority": "24h", "category": "supply",
        })
    if any_uncovered:
        parts = [f"{_n(uncovered[k])} {label}" for k, label in
                 (("ppe_units", "PPE"), ("antiviral_doses", "antivirals"), ("vaccine_doses", "vaccines"))
                 if uncovered[k] > 0]
        directives.append({
            "action": "Escalate the remaining shortfall to the national reserve",
            "detail": f"{', '.join(parts)} could not be covered by SAFE hubs within reach.",
            "priority": "24h", "category": "supply",
        })
    watch = [n for n in ctx["neighbours"] if n["status"] in ("ELEVATED", "CRITICAL")]
    if watch:
        listed = ", ".join(f"{n['name']} ({n['status']})" for n in watch)
        directives.append({
            "action": "Move neighbouring catchments to daily wastewater sampling",
            "detail": f"Neighbours showing elevated risk: {listed}.",
            "priority": "24h", "category": "surveillance",
        })
    transit = ctx["mobility_index"] > config.TRANSIT_MOBILITY_M * 100
    directives.append({
        "action": "Issue a public advisory",
        "detail": "Symptoms, testing sites and when to stay home"
                  + (f"; masks on public transport (mobility index {ctx['mobility_index']}/100)."
                     if transit else "."),
        "priority": "72h", "category": "communication",
    })
    return {"headline": headline, "rationale": rationale, "directives": directives}
