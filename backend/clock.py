"""The background clock: one simulated day per `seconds_per_day` while playing.

While a proposed stock move awaits a decision the clock is *held*: it stays in play mode
but skips ticks, and resumes by itself once the move is approved or overridden.
"""

import asyncio

from backend import config
from backend.simulation import AwaitingApproval, Conflict, Simulation


async def run_clock(sim: Simulation, control: asyncio.Event) -> None:
    """Tick while `control` is set. `control` is only touched on the event-loop thread."""
    while True:
        await control.wait()                        # paused: no CPU spent at all
        await asyncio.sleep(sim.seconds_per_day)    # a speed change applies from the next tick
        if not sim.playing:                         # a pause during the sleep cancels this tick
            control.clear()
            continue
        if sim.awaiting_approval:                   # held: try again next tick
            continue
        try:
            # The rescore takes ~0.1-0.2 s, so run it off the event loop.
            result = await asyncio.to_thread(sim.step, "clock")
        except AwaitingApproval:                    # a proposal landed meanwhile: stay in play mode
            continue
        except Conflict:                            # someone stepped to the end meanwhile
            sim.pause()
            control.clear()
            continue
        if result.clock["at_end"]:
            control.clear()                         # auto-pause on the last day


async def run_approvals(sim: Simulation) -> None:
    """Auto-approve proposed stock moves nobody objected to within the timeout."""
    while True:
        await asyncio.sleep(config.APPROVAL_POLL_S)
        if sim.awaiting_approval:
            await asyncio.to_thread(sim.expire_due)
