// packages/lib/src/custom-fields/ownership.ts

/**
 * A field is "protected" when its definition (name, type, options, …) and its
 * existence are owned by the platform or an installed app, not the user:
 *
 * - `systemAttribute` — platform/system field (e.g. primary_email).
 * - `appInstallationId` — app-registered field; only uninstall removes it.
 *
 * Protected fields are user-read-only: the API rejects user edits/deletes of
 * them. The two markers are parallel — app fields do **not** set
 * `systemAttribute`.
 */
export const isProtectedField = (f: {
  systemAttribute: string | null
  appInstallationId: string | null
}) => !!f.systemAttribute || !!f.appInstallationId

/** The three field types whose `options` array is a list a value can be chosen from. */
const OPTION_BEARING = new Set(['SINGLE_SELECT', 'MULTI_SELECT', 'TAGS'])

/** Type-derived default for {@link fieldAllowsNewOptions} when nothing is stored. */
const GROWS_BY_DEFAULT = 'TAGS'

/**
 * May an **automated writer** (an import, a paste, a bulk action) append new
 * options to this field's taxonomy?
 *
 * This is the AUTHORITY half of the question — *is it permitted at all*. The
 * preference half is {@link fieldAllowsNewOptions}. Both must be true, and this
 * is the single authority for the first, so the surface that decides whether to
 * OFFER creation and the writer that decides whether to REFUSE it ask the same
 * question. Two copies of this rule drift, and the copy that drifts open is a
 * CSV rewriting a system enum.
 *
 * | field | answer | why |
 * | --- | --- | --- |
 * | custom SELECT / MULTI_SELECT / TAGS | yes | not protected — the user owns the field outright |
 * | system TAGS (e.g. `part.category`) | yes | `updateCustomField`'s documented exception: tags are user-grown DATA, not configuration |
 * | system SELECT / MULTI_SELECT | no | its option set IS configuration — nothing should invent a ticket status |
 * | app-owned | no | only uninstall edits those |
 * | connector-owned | no | see below |
 *
 * 🛑 **Deliberately NARROWER than `updateCustomField`'s own guard**, in one
 * place: a connector-provisioned field is marked by `dataConnectorId`, not
 * `appInstallationId`, so neither `isProtectedField` nor the TAGS carve-out
 * excludes it and the write WOULD be accepted. It is excluded here because the
 * connector DECLARES its option set (`provision.options`) and re-provisions it
 * on deploy — the taxonomy already has a designated writer, and an option this
 * side minted is foreign to that declaration. A redeploy that moves an
 * id-carrying option's `value` cascade-deletes its values, so the cost of
 * getting it wrong is lost records, not lost configuration.
 *
 * That divergence is a product decision, not an oversight. Do not "fix" it by
 * widening this predicate to match the writer.
 *
 * @param f - The field's type and its three ownership markers
 * @returns True when an automated writer may append options to this field
 */
export const canGrowFieldOptions = (f: {
  type: string
  systemAttribute?: string | null
  appInstallationId?: string | null
  dataConnectorId?: string | null
}) => {
  if (!OPTION_BEARING.has(f.type)) return false
  if (f.appInstallationId || f.dataConnectorId) return false
  // Protected-but-TAGS is the exception; protected-and-anything-else is not.
  return !f.systemAttribute || f.type === GROWS_BY_DEFAULT
}

/**
 * Has this field's taxonomy been left open to automated growth?
 *
 * The PREFERENCE half, paired with {@link canGrowFieldOptions}'s authority
 * half. Read from `CustomField.options.allowNewOptions`, which is **tri-state**:
 *
 * - `undefined` — inherit the type default: TAGS grow, SELECT sets do not. A
 *   tag vocabulary is user-grown data by definition; a select's option set is
 *   curated configuration.
 * - `true` / `false` — the user decided, and their choice wins for either type.
 *
 * Tri-state is what makes this need **no backfill**: no migration, no registry
 * declaration, no seeder change, and nothing added to any existing field.
 * `part.category` grows on day one because it is TAGS, not because a row was
 * touched.
 *
 * ⚠️ Unrelated to `options.ai.allowNewOptions`, which answers a different
 * question — *may the MODEL invent labels* — and must stay independent, so that
 * turning off AI autofill does not silently disable imports.
 *
 * @param f - The field's type and its stored options envelope
 * @returns True when new options may be minted for this field
 */
export const fieldAllowsNewOptions = (f: {
  type: string
  options?: { allowNewOptions?: boolean } | null
}) => f.options?.allowNewOptions ?? f.type === GROWS_BY_DEFAULT
