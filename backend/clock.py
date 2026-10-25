"""The background clock: one simulated day per `seconds_per_day` while playing.

Incident notification approvals and report delivery never block simulation ticks.
"""

import asyncio

from backend.simulation import Conflict, Simulation


async def run_clock(sim: Simulation, control: asyncio.Event) -> None:
    """Tick while `control` is set. `control` is only touched on the event-loop thread."""
    while True:
        await control.wait()                        # paused: no CPU spent at all
        await asyncio.sleep(sim.seconds_per_day)    # a speed change applies from the next tick
        if not sim.playing:                         # a pause during the sleep cancels this tick
            control.clear()
            continue
        try:
            # The rescore takes ~0.1-0.2 s, so run it off the event loop.
            result = await asyncio.to_thread(sim.step, "clock")
        except Conflict:                            # someone stepped to the end meanwhile
            sim.pause()
            control.clear()
            continue
        if result.clock["at_end"]:
            control.clear()                         # auto-pause on the last day
