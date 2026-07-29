// apps/web/src/server/lib/field-value-host-access.ts

import type { Database } from '@auxx/database'
import { getCachedResources, getCachedUserMailVisibility } from '@auxx/lib/cache'
// Type-only, so it is erased at runtime and never pulls the (vitest-hostile)
// permissions barrel into this module's import graph.
import type { CapabilityView } from '@auxx/lib/permissions'
import { buildDefIdToSlug, PermissionKey } from '@auxx/lib/permissions'
import { assertCanActOnThreads } from '@auxx/lib/threads'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId } from '@auxx/types/resource'

/** The mailbox def slugs a generic field write can land on. */
const INBOX_DEF_SLUGS = new Set(['inbox', 'personal_inbox'])

type InboxDefSlug = 'inbox' | 'personal_inbox'

/**
 * Write authorization for the GENERIC field-value path, per host definition —
 * plan 40 §5.5, the fix for a live 403.
 *
 * The repro: applying a tag from a thread's Tags field 403'd with "You don't
 * have permission to edit these records", while the *same* tag on the *same*
 * thread applied fine from the mail list's bulk toolbar. Two surfaces, two
 * authorities — `thread.tagBulk` asks the mail question, `fieldValue.set` asked
 * the records question. `canEditEntity` short-circuits on `isMailInfraDef` →
 * `canWriteEntity` → there is no `ENTITY_WRITE_KEYS['thread']` → `records.edit`.
 * **No lever targets `thread` at all**, so the only way to let a member tag a
 * thread from the field was Records → `Edit` org-wide.
 *
 * The fix follows plan 40 §1.1's own principle: *a thread field write is a
 * thread mutation, so it takes question 4's gate.* Three branches, decided by
 * the host's resolved entity SLUG:
 *
 * | host def            | gate                                                     |
 * |---------------------|----------------------------------------------------------|
 * | `thread`            | front door `inboxes.view` **+** `full` lens on the thread |
 * | `inbox`/`personal_inbox` | `assertAdminInstance` — settings are the Manager's   |
 * | everything else     | `assertEditEntity` (unchanged)                            |
 *
 * so the Tags field and the bulk toolbar read the same two gates with no special
 * case in either. The lens half is the **shared**
 * {@link import('@auxx/lib/threads').assertCanActOnThreads} that
 * `ThreadMutationService` delegates to, not a second copy — the
 * `workflow-run-stop-access.ts` precedent, and the whole point of the fix.
 *
 * **Resolution is by SLUG, never by the raw RecordId def part.** The mail UI
 * mints its thread RecordId from `useResource('thread').entityDefinitionId`,
 * i.e. the def's CUID (`use-thread-tags.ts`), so a literal `=== 'thread'` test
 * would miss the live repro entirely — the same CUID-vs-slug shape as the
 * inbox-grant bug in plan 40 §5.1. `buildDefIdToSlug` over the org `resources`
 * cache is the resolver every other layer already uses.
 *
 * **What this deliberately does NOT do:** it adds no `ENTITY_BASE_AREAS` or
 * `ENTITY_WRITE_KEYS` entry for `thread`, and `thread` stays in
 * `NON_RECORD_DEF_SLUGS`. Under the shipped two-rung `Area.inboxes` ladder the
 * area-derived record base at `Read` is `view`, so routing `thread` through the
 * records layer would 403 **every** baseline member — the live bug, universalised
 * (plan 40 §5.5, superseding the parallel session's mechanism).
 *
 * **No inbox-instance filter on the thread branch**, by design (§1.4): in a
 * dispatch org the assignee holds no `ResourceAccess` row on the inbox by
 * construction. The lens predicate already seeds `Thread.assigneeId === userId`,
 * so assigned threads survive any inbox exclusion — an instance assert here
 * would deny exactly the people the model exists to serve.
 */
export async function assertFieldValueHostsWritable(params: {
  db: Database
  capabilities: CapabilityView
  organizationId: string
  userId: string
  /** Host RecordIds, or `{ entityDefinitionId, entityInstanceId }` pairs. */
  hosts: Array<RecordId | { entityDefinitionId: string; entityInstanceId: string }>
}): Promise<void> {
  const { db, capabilities, organizationId, userId, hosts } = params
  if (hosts.length === 0) return

  const parsed = hosts.map((host) =>
    typeof host === 'string' ? parseRecordId(host) : host
  ) as Array<{ entityDefinitionId: string; entityInstanceId: string }>

  // `capabilityProcedure` → `getCapabilities` already read `resources` for this
  // org on the way in, so this resolves off a warm org cache rather than adding
  // a roundtrip per field write.
  const toSlug = buildDefIdToSlug(await getCachedResources(organizationId))

  const threadIds: string[] = []
  /** Record hosts are asserted per DISTINCT def; thread/inbox hosts per INSTANCE. */
  const assertedDefs = new Set<string>()

  for (const { entityDefinitionId, entityInstanceId } of parsed) {
    const slug = toSlug(entityDefinitionId)

    if (slug === 'thread') {
      threadIds.push(entityInstanceId)
      continue
    }

    if (INBOX_DEF_SLUGS.has(slug)) {
      // An inbox's fields ARE its settings (name, colour, status, lens floor),
      // so a generic write to one is a Manager action — plan 40 §5.3. Keyed by
      // the resolved slug, which is also the instance-access key.
      capabilities.assertAdminInstance(slug as InboxDefSlug, entityInstanceId)
      continue
    }

    // Every non-mail def keeps the def-aware Layer-2 × Layer-3 edit gate.
    if (assertedDefs.has(entityDefinitionId)) continue
    assertedDefs.add(entityDefinitionId)
    capabilities.assertEditEntity(entityDefinitionId)
  }

  if (threadIds.length === 0) return

  // The front door first — `inboxes: None` means none, and it must answer before
  // any thread row is read so the denial cannot double as an existence oracle.
  // `permissionProcedure` honours instance-derived keys, so a member at area
  // `None` holding one explicit inbox `view` row still gets through here.
  capabilities.assert(PermissionKey.inboxesView)

  const viewer = await getCachedUserMailVisibility(userId, organizationId)
  await assertCanActOnThreads(db, organizationId, viewer, threadIds)
}
