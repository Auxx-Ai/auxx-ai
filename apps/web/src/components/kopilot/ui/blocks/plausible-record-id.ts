// apps/web/src/components/kopilot/ui/blocks/plausible-record-id.ts

import { isRecordId, type RecordId } from '@auxx/lib/resources/client'

/**
 * Kopilot-local plausibility check for a MODEL-AUTHORED record id.
 *
 * The shared `isRecordId` only asks whether the string contains a colon, and
 * that is deliberate — it guards hand-built ids all over the app and many call
 * sites rely on its looseness. But a model writing an entity fence can put any
 * string in `recordId`, and one string in particular passes: an app-block
 * WORKFLOW NODE id. Nodes are minted as `generateId(type)`, so an app block's
 * node id is `<appId>:<blockId>-<nanoid>` — e.g.
 * `z3prnwpd3rt31mp7f9yxo5m6:fedex-DmJuCD8M2cAE0Hqdua0Ns`. It has a colon, so it
 * reaches `EntityCardItem` as a lookup that can never resolve and renders the
 * user a "Record unavailable" card over a raw node id (plan 17 live run).
 *
 * The instance segment is the discriminator: every id we mint for a record row
 * is a cuid2 (`createId()`) or a better-auth id — opaque alphanumerics, never a
 * hyphen — while `generateId(prefix)` ALWAYS joins its prefix to the nanoid
 * with one. The definition segment stays untouched: it is a cuid2 for custom
 * entities but a slug (`contact`, `personal_inbox`) for the system tables, and
 * tightening it would drop real records.
 *
 * This is a display-time filter, not a type-level claim — it must stay local to
 * the block renderers rather than leak back into `@auxx/types`, whose
 * `isRecordId` guards ids the app itself built. The cost of being wrong is
 * bounded either way: a mis-rejected id drops one card, it never breaks a turn.
 */
export function isPlausibleRecordId(value: unknown): value is RecordId {
  if (!isRecordId(value)) return false
  const parts = value.split(':')
  if (parts.length !== 2) return false
  const [definitionId, instanceId] = parts
  if (!definitionId || !instanceId) return false
  return !instanceId.includes('-')
}
