// packages/lib/src/write-policy/types.ts

/**
 * Write-policy vocabulary shared by the two bulk writers, the data-connector
 * sink and the CSV importer.
 *
 * Both answer the same three questions (*which columns identify a record*,
 * *what happens to an existing value*, *how a reference becomes a link*) and
 * the connector side got there first with first-class unions. Rather than let
 * the importer grow a parallel vocabulary, the three policy types live here and
 * `data-connectors/types.ts` re-exports them, so nothing on that side moves.
 *
 * Only the *policy* types are shared. `FieldMapping` itself stays in
 * data-connectors, it carries `expression`, `sourceFields`, `provision` and
 * `connectionMetaKey`, all connector-specific.
 */

/** How an identity-match value is canonicalized before comparison. */
export type IdentityNormalize = 'email' | 'phone' | 'domain' | 'none'

/**
 * Per-field write behavior. Absent ⇒ `'overwrite'`.
 *
 * - `overwrite`, the source value wins.
 * - `fill_blank`, write only when the TARGET is empty ("don't clobber what a
 *   human set"). Distinct from the importer's blank-source rule, which asks
 *   whether the SOURCE cell is empty. The two compose.
 * - `connector_owned_only`, connector-only; write only fields this connector
 *   already owns. Not offered by the importer.
 * - `manual_review`, connector-only; record a drift suggestion instead of
 *   writing. Not offered by the importer.
 * - `ignore`, never write; the binding is projection-only. For the importer
 *   this means "map this column for the create path only".
 */
export type FieldMergeStrategy =
  | 'overwrite'
  | 'fill_blank'
  | 'connector_owned_only'
  | 'manual_review'
  | 'ignore'

/**
 * The identity ROLE a bound field / mapped column plays. One discriminated
 * union structurally enforces "at most one role per field".
 *
 * - `externalId`, this field is (part of) the upstream stable id used for
 *   re-identification. `order` sequences a first-non-null fallback CHAIN.
 * - `match`, a match key. More than one column carrying `match` **is** the
 *   composite key, with no new concepts: the candidates are ANDed.
 *
 * Absent = the field is projected only.
 */
export type IdentityRole =
  | { kind: 'externalId'; order?: number }
  | { kind: 'match'; normalize?: IdentityNormalize }

/**
 * The subset of {@link FieldMergeStrategy} the CSV importer offers.
 *
 * `connector_owned_only` and `manual_review` are dropped deliberately: neither
 * has an import meaning (an import has no ownership ledger and no drift queue).
 * The importer validates against this list rather than the full union so an
 * unrenderable value can never be persisted on an `ImportMappingProperty`.
 */
export const IMPORT_MERGE_STRATEGIES = ['overwrite', 'fill_blank', 'ignore'] as const

/** Merge strategies the importer accepts. */
export type ImportMergeStrategy = (typeof IMPORT_MERGE_STRATEGIES)[number]

/** True when `value` is a merge strategy the importer supports. */
export function isImportMergeStrategy(value: unknown): value is ImportMergeStrategy {
  return typeof value === 'string' && (IMPORT_MERGE_STRATEGIES as readonly string[]).includes(value)
}

/**
 * Ambiguity policy for a shared identity resolver. No default, the two
 * consumers disagree on purpose and both must say which they mean:
 *
 * - the connector sink takes `'first'` (a sync must not fail on data the user
 *   can only fix by merging, and it files a `DuplicateSuggestion` instead),
 * - the importer takes `'error'` (an import is interactive; the user is present
 *   and the file is in front of them, so a hard row error surfaced in the
 *   preview is strictly better than an arbitrary pick).
 *
 * Sharing a default here would silently reintroduce "update an arbitrary
 * record" on the import path.
 */
export type OnAmbiguous = 'first' | 'error'
