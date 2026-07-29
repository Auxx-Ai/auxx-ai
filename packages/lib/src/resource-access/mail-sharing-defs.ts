// packages/lib/src/resource-access/mail-sharing-defs.ts

/**
 * The ResourceAccess `entityDefinitionId` SLUGS whose grants feed the mail
 * visibility evaluator (mail-permissions §2/§7).
 *
 * Kept in a dependency-free leaf module rather than beside
 * {@link import('./mail-sharing-guard').assertCanManageMailSharing}: the write
 * funnels in `resource-access-service` need this predicate for their keyspace
 * backstop (plan 40 §5.1), and `mail-sharing-guard` imports `hasPermission`
 * back out of that service. Importing the guard from the service would close
 * that cycle and drag the guard's `../permissions/visibility` +
 * `feature-permission-service` dependencies into every consumer of the service.
 *
 * `mail-sharing-guard` re-exports {@link isMailSharingDef}, so the public
 * surface (`@auxx/lib/resource-access`) is unchanged.
 *
 * **`personal_inbox` (plan 40 §3 / 40a §1.3).** Membership here is what makes the
 * new def inherit the RecordId def-keyspace canonicalization at the
 * resource-access boundary (#1388's `canonicalMailRecordId` + this module's
 * write-funnel backstop) — without it, a CUID-keyed personal-inbox grant would be
 * written into a keyspace mail visibility never reads AND would skip
 * {@link import('./mail-sharing-guard').assertCanManageMailSharing} entirely.
 *
 * It is inert until the def is seeded (phase 1 is behavior-inert by design). The
 * grant-reading half of the lockstep (40a §4) now routes through
 * {@link isInboxDef} below.
 */
export const MAIL_SHARING_DEFS = new Set(['inbox', 'personal_inbox', 'thread', 'contact'])

/** True when grants on this definition affect mail visibility. */
export function isMailSharingDef(entityDefinitionId: string): boolean {
  return MAIL_SHARING_DEFS.has(entityDefinitionId)
}

/**
 * The subset of {@link MAIL_SHARING_DEFS} whose grants key an INBOX instance —
 * the two defs a mailbox can live on (plan 40 §3 / 40a §4).
 *
 * `ResourceAccess.entityDefinitionId` is a dual keyspace with no FK
 * (`resource-access.ts:38-68`): mail rows carry the literal SLUG, so an inbox
 * grant reads `'inbox'` or — once data migration 060 moves personal mailboxes
 * onto the new def and re-keys their rows in the same transaction —
 * `'personal_inbox'`. **Every site that BUCKETS or QUERIES inbox grant rows must
 * test both**, or a personal mailbox's owner silently loses their own inbox: the
 * rows are still there, nothing throws, they just stop being read.
 *
 * The membership test is deliberately the ROW's def (or the INSTANCE's actual
 * `EntityDefinition`), never the `inbox_is_personal` marker. Instance and rows
 * move defs together in 060, so a def-derived test stays in lockstep with the
 * data at every point; a marker-derived one would diverge the moment the two
 * disagree — which is exactly the window 060 opens.
 */
export const INBOX_DEFS = new Set(['inbox', 'personal_inbox'])

/** True when grants on this definition key an inbox instance. */
export function isInboxDef(entityDefinitionId: string): entityDefinitionId is InboxDef {
  return INBOX_DEFS.has(entityDefinitionId)
}

/** The two ResourceAccess def slugs a mailbox's grant rows can be keyed by. */
export type InboxDef = 'inbox' | 'personal_inbox'
