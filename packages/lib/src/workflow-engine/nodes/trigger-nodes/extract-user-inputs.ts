// packages/lib/src/workflow-engine/nodes/trigger-nodes/extract-user-inputs.ts

import { isAppInputField } from '../utils/app-input-fields'

/**
 * Extract user-configured input fields from app trigger node data,
 * stripping platform metadata so only app-specific inputs remain.
 *
 * Shares {@link isAppInputField} with the app-block processor — app triggers and app blocks
 * are built by the same `node-factory.ts` / `workflow-block-registry.tsx`, so their `node.data`
 * shape is identical and one notion of "app input" governs both.
 */
export function extractUserInputs(data: Record<string, unknown>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!isAppInputField(key)) continue
    inputs[key] = value
  }
  return inputs
}
