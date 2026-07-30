// packages/lib/src/permissions/visibility/audience.ts

/**
 * Which org members see an inbox at `full` lens — the ingest count-delta
 * audience (§10.1) and, in Phase 3, the realtime full-channel audience.
 * Composed entirely from org caches: members + memberRoleMap + inboxes + the
 * inverted inbox grants in `mailGrantIndex`.
 *
 * Personal-inbox capping (§11) is honored: on a personal inbox only the owner
 * and explicit full-lens grantees are in the audience — mail admins are capped
 * at metadata and there is no org-wide floor at all (fail closed).
 *
 * ## What `defaultLens` means here now (plan 40 §6)
 *
 * The floor test below reads the SAME `inbox.defaultLens` it always did, but the
 * value behind it changed source: since the floor moved onto `ResourceAccess`
 * rows, `org:inboxes` derives it from the inbox's `role:org_member` baseline row
 * (absent row ⇒ `full`, the org-shared default) instead of the
 * `inbox_default_lens` FieldValue. So a floor edit in the UI now actually
 * reshapes this fan-out — it did not before, which is the live no-op this slice
 * fixed. No extra IO: the org cache already carries it.
 *
 * ⚠ **NOT AN ENFORCEMENT PATH — a deliberate OVER-APPROXIMATION** (plan 40 §4.3,
 * settled). Two approximations remain, both upward (an audience that is too
 * wide, never too narrow):
 *
 *  1. **`defaultLens === 'read'` ⇒ every member.** The real floor for a
 *     baseline-row-less inbox is the member's own `Area.inboxes` level, so a
 *     member whose profile closes the area is included here but sees nothing. A
 *     faithful answer needs one capability-blob read per member per ingested
 *     message, and this runs on the ingest hot path.
 *  2. **The `memberRoleMap` sweep still reads org RANK**, which phase 2 removed
 *     from every authorization surface in the mail path. On an inbox with an
 *     authored sub-`full` floor, admins are added whether or not they hold a
 *     grant.
 *
 * Audience is notification plumbing: it decides who gets an unread-count delta
 * and a realtime nudge, never what they can open. Content stays lens-gated at
 * read (`buildMailVisibilityPredicate`) and redacted at publish
 * (`redactThreadPatch`), and the counts themselves are recomputed per user
 * against their own composed floor by `computeAndSeedMailCounts` — so the
 * reconcile job heals any inflation this produces.
 *
 * Known residue, accepted: a custom-downgraded admin may receive unread-count
 * deltas for mail they can no longer open, until the next reconcile. Revisit only
 * if it bites — do NOT quietly promote this to an access check.
 */
export async function getFullLensAudienceForInbox(
  orgId: string,
  inboxId: string
): Promise<string[]> {
  // Lazy import — the visibility module core stays pure; cache providers
  // import siblings from this folder.
  const { getOrgCache } = await import('../../cache')
  const orgCache = getOrgCache()

  const [members, roleMap, inboxes, grantIndex] = await Promise.all([
    orgCache.get(orgId, 'members'),
    orgCache.get(orgId, 'memberRoleMap'),
    orgCache.get(orgId, 'inboxes'),
    orgCache.get(orgId, 'mailGrantIndex'),
  ])

  const inbox = inboxes.find((i) => i.id === inboxId)
  const audience = new Set<string>()

  if (inbox?.isPersonal) {
    if (inbox.ownerUserId) audience.add(inbox.ownerUserId)
    for (const entry of grantIndex.inboxes[inboxId] ?? []) {
      if (entry.lens === 'read') audience.add(entry.userId)
    }
    return [...audience]
  }

  // Row-derived floor (see the header): `full` means "no authored baseline row",
  // i.e. the org-shared default via the `Area.inboxes` fallback. Approximation 1.
  if (inbox?.defaultLens === 'read') {
    for (const m of members) audience.add(m.userId)
    return [...audience]
  }

  for (const m of members) {
    const role = roleMap[m.userId]?.role
    if (role === 'OWNER' || role === 'ADMIN') audience.add(m.userId)
  }
  for (const entry of grantIndex.inboxes[inboxId] ?? []) {
    if (entry.lens === 'read') audience.add(entry.userId)
  }
  return [...audience]
}
