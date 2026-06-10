// packages/lib/src/ai/kopilot/continuation-surface.ts

/**
 * Surface (page + reference context) restoration for continuation turns.
 *
 * Approval resumes and task-notification turns POST to `/api/kopilot/stream`
 * without `page` or `context` — the originating surface isn't on screen when
 * the drain fires, and the approval card doesn't re-send it. Without this the
 * route rebuilds a smaller, page-less toolset, so `engine.resume()` can't find
 * the page-scoped tool it paused on (e.g. `run_eval_suite`) and the paused
 * `tool_use` is left dangling — the next turn 400s on the provider.
 *
 * Contract: the request always wins when present (the client's live context is
 * fresher than anything persisted). The `domainState` fallback applies ONLY to
 * continuations — a fresh `type: 'message'` turn with no page deliberately
 * stays page-less (global rail → `__global__` tools only) and must NOT inherit
 * a prior turn's surface.
 */

/** Persisted-surface keys stashed in the session's domainState each turn. */
export const LAST_PAGE_KEY = '_lastPage'
export const LAST_CONTEXT_KEY = '_lastContext'

export interface ResolveContinuationSurfaceInput {
  /** `page` from the inbound request (undefined on continuations). */
  requestPage?: string
  /** Reference `context` from the inbound request (undefined on continuations). */
  requestContext?: Record<string, unknown>
  /** True for approval resumes and task-notification turns. */
  isContinuation: boolean
  /** The session's persisted domainState (holds `_lastPage` / `_lastContext`). */
  domainState: Record<string, unknown>
}

export interface ResolveContinuationSurfaceResult {
  page?: string
  context?: Record<string, unknown>
}

/**
 * Resolve the effective surface for a turn: request values when present,
 * otherwise the persisted surface — but only for continuation turns.
 */
export function resolveContinuationSurface(
  input: ResolveContinuationSurfaceInput
): ResolveContinuationSurfaceResult {
  const { requestPage, requestContext, isContinuation, domainState } = input

  if (!isContinuation) {
    return { page: requestPage, context: requestContext }
  }

  const lastPage = domainState[LAST_PAGE_KEY]
  const lastContext = domainState[LAST_CONTEXT_KEY]

  return {
    page: requestPage ?? (typeof lastPage === 'string' ? lastPage : undefined),
    context:
      requestContext ??
      (lastContext && typeof lastContext === 'object'
        ? (lastContext as Record<string, unknown>)
        : undefined),
  }
}
