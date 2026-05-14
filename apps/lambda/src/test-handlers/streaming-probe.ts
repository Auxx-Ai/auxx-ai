// apps/lambda/src/test-handlers/streaming-probe.ts

/**
 * Streaming probe handler — yields 3 progress events at 500ms intervals
 * followed by a result event. Used only by the lambda-streaming spike to
 * verify that chunks arrive at the caller on cadence (not buffered).
 *
 * SPIKE: see plans/kopilot/apps/lambda-streaming-spike.md
 * Delete this file (and the streaming-probe branch in lambda-runtime.ts)
 * once the spike verdict is in.
 */

import type { StreamEvent } from '../runtime/stream-response.ts'

export async function* streamingProbe(opts: {
  steps?: number
  intervalMs?: number
}): AsyncGenerator<StreamEvent> {
  const steps = opts.steps ?? 3
  const intervalMs = opts.intervalMs ?? 500
  const startedAt = Date.now()

  for (let i = 1; i <= steps; i++) {
    yield {
      event: 'progress',
      data: {
        step: i,
        total: steps,
        elapsedMs: Date.now() - startedAt,
        emittedAt: Date.now(),
      },
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  yield {
    event: 'result',
    data: {
      ok: true,
      steps,
      totalElapsedMs: Date.now() - startedAt,
      emittedAt: Date.now(),
    },
  }
}
