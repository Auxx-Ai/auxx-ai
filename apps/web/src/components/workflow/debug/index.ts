// apps/web/src/components/workflow/debug/index.ts

export { endDragWindow, recordDragFrame, startDragWindow } from './drag-probe'
export { perfNow, WORKFLOW_PERF_ENABLED } from './perf-flag'
// NOTE: `perf-switch.tsx` is deliberately NOT re-exported here. It pulls in
// `@auxx/ui` (Radix), and this barrel is imported by plain store/hook modules
// (`store/use-var-store.ts`, `hooks/use-node-interactions.ts`) that must not
// reach UI code. Import it from `debug/perf-switch` directly.
export { getRenderCounts, resetRenderCounts, useRenderTrace } from './render-trace'
export { measureSync } from './user-timing'
