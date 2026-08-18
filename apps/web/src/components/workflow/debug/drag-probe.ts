// apps/web/src/components/workflow/debug/drag-probe.ts

import { perfNow, WORKFLOW_PERF_ENABLED } from './perf-flag'
import { getRenderCounts, resetRenderCounts } from './render-trace'

/** A gap between pointer frames longer than this is a dropped frame (60fps budget). */
const FRAME_BUDGET_MS = 16.7

interface DragWindow {
  openedAt: number
  lastFrameAt: number
  frames: number
  droppedFrames: number
  handlerMs: number
  setNodesMs: number
}

let openWindow: DragWindow | null = null

/**
 * Open a drag measurement window. The gesture is the unit of measurement,
 * because the subscription regressions this probes for only exist during one.
 */
export function startDragWindow(): void {
  if (!WORKFLOW_PERF_ENABLED) return
  resetRenderCounts()
  const openedAt = perfNow()
  openWindow = {
    openedAt,
    lastFrameAt: openedAt,
    frames: 0,
    droppedFrames: 0,
    handlerMs: 0,
    setNodesMs: 0,
  }
}

/**
 * Record one pointer frame: how long the drag handler ran, how much of that was
 * `setNodes`, and how long since the previous frame.
 *
 * @param frameStartedAt `perfNow()` taken at the top of the drag handler
 * @param setNodesMs time spent inside `setNodes` during this frame
 */
export function recordDragFrame(frameStartedAt: number, setNodesMs: number): void {
  if (!openWindow) return

  const now = perfNow()
  if (openWindow.frames > 0 && now - openWindow.lastFrameAt > FRAME_BUDGET_MS) {
    openWindow.droppedFrames += 1
  }

  openWindow.lastFrameAt = now
  openWindow.frames += 1
  openWindow.handlerMs += now - frameStartedAt
  openWindow.setNodesMs += setNodesMs
}

/**
 * Close the window and emit the report: one `console.table` of per-component
 * render counts sorted by count, plus one summary line. A component whose
 * `rendersPerFrame` is ~1 re-rendered on every pointer frame — that component
 * is the regression.
 */
export function endDragWindow(): void {
  const closed = openWindow
  if (!closed) return
  openWindow = null

  const durationMs = perfNow() - closed.openedAt
  const rows = getRenderCounts().map(({ component, renders }) => ({
    component,
    renders,
    rendersPerFrame: closed.frames > 0 ? Number((renders / closed.frames).toFixed(2)) : 0,
  }))

  console.table(rows)
  console.info(
    `[workflow:perf] drag ${durationMs.toFixed(1)}ms · ${closed.frames} frames · ` +
      `${closed.droppedFrames} dropped (>${FRAME_BUDGET_MS}ms) · ` +
      `handler ${closed.handlerMs.toFixed(1)}ms · setNodes ${closed.setNodesMs.toFixed(1)}ms`
  )
}
