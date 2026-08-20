// packages/lib/src/workflows/graph-edit/normalize/bare-path-fields.ts

/**
 * The one field in the builder vocabulary that takes a BARE dotted path —
 * pure, browser-safe.
 *
 * `if-else` conditions read `variableId: "Carrier.value"`. Everything else a
 * model writes is `{{Title.path}}`, and that is what the prompt drills, so the
 * taught form arrives here constantly. It used to be punished with a
 * quadruple-brace error that named neither the field nor the rule —
 * `normalizeFriendlyRefs` rewrote the INNER span to a node id and `ref-check`
 * re-wrapped the whole value for its message, producing
 * `Reference "{{{{form-input-xxx.value}}}}" points at unknown node
 * "{{form-input-xxx"` and costing one refused mutation on essentially every
 * first if-else an agent writes (plan 21 §3.4).
 *
 * So the braced form is ACCEPTED: the braces are stripped here, before
 * `normalizeFriendlyRefs` sees the value, so the bare path resolves through the
 * normal bare-ref gate. A `warning` names the field and the rule, because the
 * rule is real — it is just the exception, and an exception has to be taught
 * rather than enforced with a nonsense error.
 */

import { unwrapBracedVariableId } from '../../../workflow-engine/catalog/nodes/if-else'
import type { Issue } from '../types'

/** What {@link unwrapBracedBarePaths} returns: the corrected config plus findings. */
export interface BarePathUnwrapResult {
  config: Record<string, unknown>
  issues: Issue[]
}

/**
 * Strip a single surrounding `{{ }}` from every bare-path field in `config`,
 * reporting one `warning` per corrected field. Returns `config` untouched (and
 * no issues) when there is nothing to correct.
 *
 * Only `if-else` has such a field today. Keyed on type rather than walked
 * blindly, because stripping braces anywhere else would silently turn a real
 * reference into prose.
 */
export function unwrapBracedBarePaths(
  type: string,
  config: Record<string, unknown>
): BarePathUnwrapResult {
  if (type !== 'if-else') return { config, issues: [] }
  const cases = config.cases
  if (!Array.isArray(cases)) return { config, issues: [] }

  const issues: Issue[] = []
  const nextCases = cases.map((caseItem, caseIndex) => {
    const conditions = (caseItem as Record<string, unknown> | null)?.conditions
    if (!Array.isArray(conditions)) return caseItem
    let changed = false
    const nextConditions = conditions.map((condition, condIndex) => {
      const record = condition as Record<string, unknown> | null
      const variableId = record?.variableId
      if (typeof variableId !== 'string') return condition
      const unwrapped = unwrapBracedVariableId(variableId)
      if (unwrapped === variableId) return condition
      changed = true
      issues.push({
        severity: 'warning',
        field: `cases.${caseIndex}.conditions.${condIndex}.variableId`,
        ref: variableId,
        message:
          `Condition variableId "${variableId}" takes a BARE dotted path, not a {{…}} reference — ` +
          `the braces were stripped and "${unwrapped}" used. if-else conditions are the one ` +
          'field in the builder vocabulary that is not braced; write the path on its own.',
      })
      return { ...record, variableId: unwrapped }
    })
    return changed
      ? { ...(caseItem as Record<string, unknown>), conditions: nextConditions }
      : caseItem
  })

  if (issues.length === 0) return { config, issues: [] }
  return { config: { ...config, cases: nextCases }, issues }
}
