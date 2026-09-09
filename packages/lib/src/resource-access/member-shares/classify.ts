// packages/lib/src/resource-access/member-shares/classify.ts

/**
 * Pure classification for the member "Shared" tab (plan 46 §3.2/§3.3).
 *
 * NOTHING here touches the database or imports anything server-only — the whole
 * file is mirrored out through `resource-access/client.ts`, because the group
 * vocabulary and its copy are what the tab renders. Keep it free of `drizzle-orm`
 * as well: the SQL form of {@link isOwnerRow} lives in `queries.ts`
 * (`sharedRowPredicate`) and is built from {@link SELF_GRANTING_DEFS} so the two
 * cannot drift.
 */

/**
 * The `ResourceAccess` def keys whose CREATION PATH self-grants the creator
 * `admin` — and therefore the keys on which a NULL `grantedById` means
 * "the member's own property", not "an unattributed share".
 *
 * Why this list exists at all (plan 46 §3.2). `grantedById = granteeId` is a
 * convention, not a schema invariant, and the two ways it can be wrong are not
 * symmetric:
 *
 *  - a SHARE misread as ownership → the row survives a sweep, and an admin can
 *    still revoke it from the resource's own share card. Recoverable.
 *  - OWNERSHIP misread as a share → the row is swept and the member loses their
 *    own dashboard, snippet or signature. **Not recoverable.**
 *
 * So the classifier must err toward "owned". The naive rule
 * (`grantedById !== null && grantedById === granteeId`) errs the other way for a
 * null granter, which is exactly the shape the oldest seeded rows have. This set
 * is the correction: on these defs a null granter reads as owned; everywhere else
 * it reads as shared.
 *
 * Self-granting creation paths, as of 2026-09-09:
 *  - `snippet`    — `snippets/snippet-mutations.ts` (`createSnippet`)
 *  - `sequence`   — `sequences/access.ts` (`grantSequenceCreatorAccess`)
 *  - `dashboard`  — `dashboards/dashboard-mutations.ts` (owner grant at create)
 *  - `signature`  — data migration 056 + the signature create path
 *
 * `__tests__/classify.test.ts` enumerates the `ResourceAccess` write sites in
 * `packages/lib/src` so a NEW self-granting creation path fails that test
 * instead of quietly getting its rows swept.
 */
export const SELF_GRANTING_DEFS: ReadonlySet<string> = new Set([
  'snippet',
  'sequence',
  'dashboard',
  'signature',
])

/**
 * Defs that are NEVER owned, whoever granted them — checked before the
 * self-grant rule, so a creator's own row on one of these is still a share.
 *
 * `inbox` is here because a SHARED mailbox is not personal property. Its rows
 * are self-granted at `admin` by the provisioning path (31 of 33 in the dev
 * database), and plan 46 §3.2 originally read that statistic as ownership. It is
 * not: it says the creator's row is a CREATOR row. A shared team mailbox is
 * exactly the access an admin most wants gone when they strip a member, and
 * treating it as untouchable property meant a member bound to a profile with
 * `inboxes: None` kept reading a shared inbox after every visible share had been
 * removed — with nothing on the tab explaining why. That is the bug this set
 * fixes.
 *
 * `personal_inbox` is the opposite case and stays owned unconditionally
 * ({@link isOwnerRow}): it is the member's own mail, and disconnecting the
 * channel is the tool for it.
 *
 * ⚠ Sweeping the last `admin` row on a shared inbox leaves it with no explicit
 * manager. That is survivable — org admins reach every inbox through
 * `isMailAdmin` — but a shared inbox whose only manager was the departing member
 * needs a new one assigned, and nothing prompts for that yet.
 */
export const NEVER_OWNED_DEFS: ReadonlySet<string> = new Set(['inbox'])

/**
 * Whether a `granteeType: 'user'` row is the member's OWN property rather than
 * something somebody shared with them (plan 46 §3.2).
 *
 * Owned rows are counts-only on the tab: never listed, never selectable, and
 * excluded in SQL from every revoke scope. 96% of the `user`-grantee rows in the
 * dev database are self-granted, so this predicate — not the UI — is what keeps
 * "remove everything shared with this member" from deleting their own snippets.
 *
 * The `personal_inbox` clause is unconditional and is NOT an optimization: a
 * personal mailbox is the member's own mail, `disconnectPersonalChannelsForUser`
 * is the tool for removing it, and it must survive a sweep even when its
 * `grantedById` is null or an admin's — which happens.
 */
export function isOwnerRow(row: {
  granteeId: string
  grantedById: string | null
  entityDefinitionId: string
}): boolean {
  if (row.entityDefinitionId === 'personal_inbox') return true
  if (NEVER_OWNED_DEFS.has(row.entityDefinitionId)) return false
  if (row.grantedById === null) return SELF_GRANTING_DEFS.has(row.entityDefinitionId)
  return row.grantedById === row.granteeId
}

/**
 * The resource-type vocabulary the tab groups by (plan 46 §3.3).
 *
 * One key per reserved `ResourceAccess` def slug, plus `record` for the CUID
 * keyspace — every custom or system CRM definition. Record groups sub-group by
 * definition in the summary (`entityDefinitionId` is carried alongside the group
 * key) because "Records: 4" is useless when it is 2 tickets and 2 work orders.
 */
export type MemberShareGroupKey =
  | 'thread'
  | 'inbox'
  | 'personal_inbox'
  | 'contact'
  | 'signature'
  | 'snippet'
  | 'sequence'
  | 'dashboard'
  | 'dataset'
  | 'kb'
  | 'workflow'
  | 'agent'
  | 'record'

/** Display copy for one group. */
export interface MemberShareGroupMeta {
  /** Plural heading, e.g. "Conversations". */
  label: string
  /** Singular noun for counts and toasts, e.g. "conversation". */
  noun: string
  /**
   * Load-bearing description, rendered under the group heading. Only `contact`
   * has one, and it is not decorative: a contact grant derives to EVERY thread
   * that contact appears on (plan 46 §5.3), so a single innocuous-looking CRM
   * row can be the widest mail grant a member holds.
   */
  description?: string
  /**
   * What actually removes the resource when the row is OWNED. Rendered as the
   * one line of copy under the "Owned by this member" counts (§3.2) — revoking
   * is not the answer there, so the section names the real path instead.
   */
  ownedRemoval?: string
}

/** Copy for every group key. Client-safe; the tab renders straight from this. */
export const MEMBER_SHARE_GROUPS: Record<MemberShareGroupKey, MemberShareGroupMeta> = {
  thread: { label: 'Conversations', noun: 'conversation' },
  inbox: {
    label: 'Inboxes',
    noun: 'inbox',
    ownedRemoval: 'Transfer or delete the inbox to remove this.',
  },
  personal_inbox: {
    label: 'Personal mailbox',
    noun: 'personal mailbox',
    ownedRemoval: 'Disconnect the mailbox to remove this.',
  },
  contact: {
    label: 'Contacts',
    noun: 'contact',
    description: 'Also grants access to every conversation this contact appears on.',
  },
  signature: {
    label: 'Signatures',
    noun: 'signature',
    ownedRemoval: 'Delete the signature to remove this.',
  },
  snippet: {
    label: 'Snippets',
    noun: 'snippet',
    ownedRemoval: 'Delete the snippet to remove this.',
  },
  sequence: {
    label: 'Sequences',
    noun: 'sequence',
    ownedRemoval: 'Delete the sequence to remove this.',
  },
  dashboard: {
    label: 'Dashboards',
    noun: 'dashboard',
    ownedRemoval: 'Transfer or delete the dashboard to remove this.',
  },
  dataset: { label: 'Datasets', noun: 'dataset' },
  kb: { label: 'Knowledge bases', noun: 'knowledge base' },
  workflow: { label: 'Workflows', noun: 'workflow' },
  agent: { label: 'Agents', noun: 'agent' },
  record: { label: 'Records', noun: 'record' },
}

/** Every reserved slug that owns a group of its own. */
const RESERVED_GROUP_KEYS: ReadonlySet<string> = new Set(
  Object.keys(MEMBER_SHARE_GROUPS).filter((k) => k !== 'record')
)

/**
 * Which group a `ResourceAccess.entityDefinitionId` belongs to.
 *
 * The column is a dual keyspace (`schema/resource-access.ts:38-68`): a reserved
 * slug names its own group; anything else is an `EntityDefinition` CUID and lands
 * in `record`, where the summary keeps the definition id so the tab can sub-group
 * and label it from the org's `resources` projection.
 */
export function groupKeyForDef(entityDefinitionId: string): MemberShareGroupKey {
  return RESERVED_GROUP_KEYS.has(entityDefinitionId)
    ? (entityDefinitionId as MemberShareGroupKey)
    : 'record'
}
