// packages/lib/src/approvals/utils.ts

import type { CapturedAction } from '../ai/agent-framework/types'
import type { ProposedAction } from './types'

/**
 * Merge in-flight soft-tool actions (draft-mode write tools — `reply_to_thread`
 * and `start_new_conversation` with `mode: 'draft'`) with the captured actions
 * the engine accumulated. Captures already carry the
 * canonical `localIndex` the model saw via `captureMint`; soft-tool actions
 * fired synchronously and don't have one. Soft actions land at the end with
 * indices renumbered from `max(captured.localIndex) + 1`.
 *
 * Order within the bundle is "captured first, soft after." Chained captures
 * reference each other's `temp_<n>` ids, so we mustn't disturb their indices.
 */
export function mergeActions(
  softActions: ProposedAction[],
  capturedActions: CapturedAction[]
): ProposedAction[] {
  const merged: ProposedAction[] = capturedActions.map((c) => ({
    localIndex: c.localIndex,
    toolName: c.toolName,
    args: c.args,
    summary: c.summary,
    predictedOutput:
      c.predictedOutput && typeof c.predictedOutput === 'object'
        ? (c.predictedOutput as Record<string, unknown>)
        : undefined,
  }))
  let nextIndex = merged.reduce((max, a) => Math.max(max, a.localIndex), -1) + 1
  for (const soft of softActions) {
    merged.push({
      ...soft,
      localIndex: nextIndex++,
    })
  }
  return merged
}

/**
 * Parse the final assistant text for the structured marker line emitted by
 * the headless system prompt: `[summary] <≤ 12 words>` if actions were
 * proposed, `[noop] <reason>` if no action is appropriate.
 *
 * If neither marker is present we log a warning at the call site and fall
 * back to the first 60 chars of final text — that path is a model-format bug
 * but should not break the run.
 */
export function parseFinalText(text: string): { summary?: string; noopReason?: string } {
  const summaryMatch = text.match(/\[summary\]\s*(.+?)\s*$/m)
  if (summaryMatch?.[1]) return { summary: summaryMatch[1].trim() }
  const noopMatch = text.match(/\[noop\]\s*(.+?)\s*$/m)
  if (noopMatch?.[1]) return { noopReason: noopMatch[1].trim() }
  if (text.length > 0) {
    return { summary: text.slice(0, 60).trim() }
  }
  return {}
}
