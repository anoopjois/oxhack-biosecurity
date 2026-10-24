"""Background LLM jobs: run after the tick commits, never block the clock."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable

from backend import config
from backend.agent.llm import DirectiveWriter, LLMOutcome, run_writer


@dataclass(frozen=True)
class LLMJob:
    episode_id: int
    context: dict


# on_result(episode_id, generation, outcome): the Simulation attaches the text to the episode,
# or discards it if a reset happened since (generation changed).
ResultCallback = Callable[[int, int, LLMOutcome], None]


class LLMWorker:
    def __init__(self, writer: DirectiveWriter, on_result: ResultCallback):
        self.writer = writer
        self.on_result = on_result
        self.pool = ThreadPoolExecutor(max_workers=config.LLM_WORKERS, thread_name_prefix="llm")

    def submit(self, job: LLMJob, generation: int):
        return self.pool.submit(self._run, job, generation)

    def _run(self, job: LLMJob, generation: int) -> None:
        self.on_result(job.episode_id, generation, run_writer(self.writer, job.context))

    def shutdown(self) -> None:
        self.pool.shutdown(wait=False, cancel_futures=True)
