// packages/lib/src/resources/picker/mail-lens-tables.ts
//
// Which system record tables are MAIL content, and therefore may never be read
// through the generic record path.
//
// A leaf module on purpose: it imports a type and nothing else, so any caller
// that needs the test can take it without dragging the picker's graph in (the
// lesson `resources/crud/record-row-access.ts` records when it lazy-imports the
// picker).

import type { TableId } from '../registry'

/**
 * `thread` and `message` are registered system resource tables — they are in
 * `RESOURCE_FIELD_REGISTRY` and therefore in `RESOURCE_TABLE_MAP` — which made
 * them reachable through every `TableId`-driven read in the picker, including
 * the global-search fan-out over `Object.keys(RESOURCE_TABLE_MAP)`.
 *
 * 🔴 **That path applies no mail lens.** The metadata / subject / full lens
 * gradations live only in `mail-query/`; the record lane's `canViewEntity('thread')`
 * is an unconditional pass-through (`permissions/capabilities/entity-access.ts`,
 * `NON_RECORD_DEF_SLUGS`), and the picker's own `recordScope` answers
 * `{ arm: 'all' }` for any `TableId`. So a member restricted to the `subject`
 * lens could reach thread rows — and, via the `thread` display config's
 * `withRelations: { messages: { with: { from: true } } }`, the body of the most
 * recent message — by typing into the global record search.
 *
 * The fix is to exclude them from the generic record path entirely rather than
 * to teach that path a second lens implementation. Callers that legitimately
 * need threads go through the mail search tooling (`mail-query/`), which is the
 * only place the lens is enforced.
 *
 * Decision recorded 2026-07-31 (`plans/search/2026-07-31-retrieval-execution-sequence.md`
 * step 0.1).
 */
export const MAIL_LENS_TABLE_IDS: ReadonlySet<TableId> = new Set<TableId>(['thread', 'message'])

/**
 * Is this resource id one of the mail-content tables the generic record path
 * must refuse? Accepts any string so callers can test an unresolved slug.
 */
export function isMailLensTableId(id: string): boolean {
  return MAIL_LENS_TABLE_IDS.has(id as TableId)
}

/** The error message every refusal uses, so the pointer is worded once. */
export const MAIL_LENS_REFUSAL =
  'Threads and messages are not readable through the generic record path — use the mail search tools (find_threads / get_thread_detail), which apply the mail visibility lens.'
