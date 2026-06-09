// packages/lib/src/evals/worker/index.ts
//
// Worker-facing surface for eval runs (enqueue, job handlers, live publication).
// Imported by apps/worker to register the `eval-run` worker + watchdog and by the
// `eval` tRPC router to enqueue. Explicit named exports (CLAUDE.md).

export {
  EVAL_RUN_JOB_NAME,
  type EvalRunJobData,
  enqueueEvalRun,
  evalRunJobId,
} from './enqueue-eval-run'
export {
  finalizeEvalRunOnTerminalFailure,
  processEvalRun,
} from './process-eval-run'
export {
  createEvalRunPublisher,
  type EvalRunEvent,
  evalRunChannel,
  subscribeToEvalRunEvents,
} from './publisher'
export { EVAL_WATCHDOG_JOB_NAME, evalRunWatchdog } from './watchdog'
