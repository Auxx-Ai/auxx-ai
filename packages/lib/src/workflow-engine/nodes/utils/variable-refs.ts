// packages/lib/src/workflow-engine/nodes/utils/variable-refs.ts

/**
 * The one rule for telling a variable reference from a literal.
 *
 * A bindable config field arrives in one of two shapes, and which one you get is
 * decided by the editor the panel used, not by the field:
 *
 * - `VarEditor` in rich-text mode writes a **template** — `"Order {{find_1.order.id}}"` —
 *   possibly with several references and surrounding literal text.
 * - `VarEditor` in `VAR_MODE.PICKER` writes a **bare dotted path** — `"find_1.order.id"` —
 *   the whole string is the variable id, with no braces at all.
 *
 * Every processor that resolves a bound field must understand both, and they must
 * all draw the literal/reference line in the same place. That line is
 * {@link BARE_VARIABLE_PATH_PATTERN}: it deliberately refuses a leading digit so
 * `"0.5"` and `"3.14"` stay numbers rather than becoming variable lookups.
 */

const TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g

/**
 * A bare variable path as the picker writes it: an identifier followed by at
 * least one dotted segment, optionally with array accessors.
 *
 * The leading `[A-Za-z_$]` is load-bearing — it is what keeps numeric literals
 * (`"0.5"`, `"3.14"`, `"1.0e3"`) out of the reference branch.
 */
export const BARE_VARIABLE_PATH_PATTERN = /^[A-Za-z_$][\w$-]*(?:\.[\w$-]+(?:\[(?:-?\d+|\*)\])?)+$/

/** Does this string carry at least one `{{…}}` reference? */
export function isVariableTemplate(value: string): boolean {
  return value.includes('{{') && value.includes('}}')
}

/**
 * Is this string a bare picker path (`node-1.result`) rather than a literal?
 *
 * Returns `false` for anything a numeric or plain-text constant could be, so it
 * is safe to consult even when the panel wrote no constant/variable flag.
 */
export function isBareVariablePath(value: string): boolean {
  return BARE_VARIABLE_PATH_PATTERN.test(value.trim())
}

/**
 * Collect the variable references a bindable config value carries.
 *
 * Covers both shapes: `{{…}}` templates (possibly several in one string) and a
 * single bare picker path.
 */
export function extractVariableRefs(value: unknown): string[] {
  if (typeof value !== 'string') return []

  const trimmed = value.trim()
  if (!trimmed) return []

  const refs = new Set<string>()
  for (const match of trimmed.matchAll(TEMPLATE_PATTERN)) {
    const id = match[1]?.trim()
    if (id) refs.add(id)
  }

  if (refs.size === 0 && isBareVariablePath(trimmed)) {
    refs.add(trimmed)
  }

  return Array.from(refs)
}
