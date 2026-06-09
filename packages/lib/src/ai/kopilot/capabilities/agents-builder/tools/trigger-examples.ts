// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/trigger-examples.ts

/**
 * Validate model-supplied `triggerExamples` before they're persisted. The tool
 * JSON Schema is only a hint to the provider — the runtime classifier consumes
 * these few-shot examples directly (`procedures/classify.ts`), where a malformed
 * entry (a `null` element, or a missing/invalid `behavior`) either THROWS during
 * live procedure selection or pollutes the prompt with `- undefined`. So we
 * validate the shape server-side, the same way `validateProcedureDsl` does for the
 * body. Returns a human-readable error string, or `null` when valid.
 */
export function validateTriggerExamples(value: unknown): string | null {
  if (!Array.isArray(value)) return 'triggerExamples must be an array.'
  for (let i = 0; i < value.length; i++) {
    const entry = value[i]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return `triggerExamples[${i}] must be an object with "text" and "behavior".`
    }
    const { text, behavior } = entry as Record<string, unknown>
    if (typeof text !== 'string' || text.trim() === '') {
      return `triggerExamples[${i}].text must be a non-empty string.`
    }
    if (behavior !== 'use' && behavior !== 'avoid') {
      return `triggerExamples[${i}].behavior must be "use" or "avoid".`
    }
  }
  return null
}
