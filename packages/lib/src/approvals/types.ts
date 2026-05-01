// packages/lib/src/approvals/types.ts

/**
 * One concrete action proposed by a headless kopilot run. The bundle the
 * scanner persists is just `ProposedAction[]` plus a summary; apply-time
 * (Phase 3e) walks them in order, substituting `temp_<n>` references in
 * `args` with real ids as each prior action lands.
 *
 * No `kind: 'soft' | 'captured'` discriminator. The two cases differ only by
 * which optional field is set:
 * - `ranDuringCapture` present → side effect already happened during the
 *   headless run (draft-mode write tools — `reply_to_thread` /
 *   `start_new_conversation` with `mode: 'draft'`); apply-time
 *   promotes/finalizes the existing artifact (e.g. schedules the existing Draft).
 * - `predictedOutput` present → tool was *captured*, not executed. Apply-time
 *   runs the tool now with `args` (after temp-ID substitution) and uses the
 *   real return value to satisfy any downstream `temp_<n>` references.
 */
export interface ProposedAction {
  /**
   * Monotonic across the run; matches the engine's `temp_<localIndex>`
   * convention so other actions can reference it via `temp_${localIndex}` in
   * their args.
   */
  localIndex: number
  toolName: string
  /**
   * Exactly the args the model passed. May contain `temp_<n>` references
   * pointing at earlier actions' predicted outputs.
   */
  args: Record<string, unknown>
  /** Human-readable card description, ≤ 80 chars. */
  summary: string
  /**
   * Set when the tool ran for real during the headless capture (draft-mode
   * write tools — `reply_to_thread` / `start_new_conversation` with
   * `mode: 'draft'`). The output (e.g. `{ draftId, threadId, body, ... }`)
   * is durable and can be referenced at apply-time without re-invoking the
   * tool — apply-time just promotes/finalizes the artifact.
   */
  ranDuringCapture?: { output: Record<string, unknown> }
  /**
   * Set when the tool was *captured* (not executed) by the engine. This is
   * the `captureMint(args)` return value — typically `{ id: 'temp_<n>', ...
   * predictedFields }`. Apply-time substitutes temp ids in downstream
   * actions' args using the real ids these mint at execution.
   */
  predictedOutput?: Record<string, unknown>
}

/** Input to `runHeadlessSuggestion()`. */
export interface HeadlessRunInput {
  organizationId: string
  /** Whose voice / signature gets snapshotted onto the bundle. */
  ownerUserId: string
  /** Required — bare-thread mode is dropped from v1. */
  entityInstanceId: string
  triggerSource: 'event' | 'stale_scan' | 'manual'
  triggerEventType?: string
  /** Sanitized event payload for the LLM. See `sanitizeEventPayloadForLLM`. */
  triggerEventPayload?: Record<string, unknown>
  /** "provider:model" — same shape used elsewhere in kopilot. */
  modelId: string
}

/**
 * Per-action outcome recorded when an approved bundle is applied (Phase 3e).
 * Stored on `AiSuggestion.outcomes` so the user can see what happened action-
 * by-action when a partial approval has mixed results.
 *
 * `skipped_dep_rejected` is for the case where action N depends on action
 * N-1 (via a `temp_<n>` reference) and N-1 was rejected — apply-time skips N
 * with this outcome instead of failing the whole bundle.
 */
export interface ActionOutcome {
  localIndex: number
  status: 'success' | 'failed' | 'skipped_dep_rejected'
  toolOutput?: Record<string, unknown>
  error?: string
}

/**
 * Shape of `AiSuggestion.bundle` JSON. Stored on the row at insert time;
 * never mutated (apply-time writes outcomes to a sibling column).
 */
export interface StoredBundle {
  actions: ProposedAction[]
  summary?: string
  noopReason?: string
  modelId: string
  headlessTraceId: string
  computedForLatestMessageId?: string
}

/** Output of `runHeadlessSuggestion()`. */
export interface HeadlessRunResult {
  /** Actions in invocation order; localIndex matches array index. */
  actions: ProposedAction[]
  /** Parsed from the final assistant text's `[summary] ...` line. */
  summary?: string
  /** Parsed from the final assistant text's `[noop] <reason>` line. */
  noopReason?: string
  /** "provider:model" mirrored from input for telemetry / persistence. */
  modelId: string
  /** Stable id ties to usage events and AiSuggestion (Phase 3c). */
  headlessTraceId: string
  /** Snapshot of when this proposal was computed; persisted for staleness gating. */
  computedForActivityAt: Date
  /** Latest message / activity id at compute time; used by Phase 3d to invalidate. */
  computedForLatestMessageId?: string
  /** Resolved during entity load; passed to bundle creation for cheap card render. */
  entityDefinitionId: string
}
