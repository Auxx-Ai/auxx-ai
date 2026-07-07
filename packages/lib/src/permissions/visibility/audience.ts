// packages/lib/src/permissions/visibility/audience.ts

/**
 * Which org members see an inbox at `full` lens — the ingest count-delta
 * audience (§10.1) and, in Phase 3, the realtime full-channel audience.
 * Composed entirely from org caches: members + memberRoleMap + inboxes
 * (defaultLens floor) + the inverted inbox grants in `mailGrantIndex`.
 *
 * Personal-inbox capping (§11) is honored: on a personal inbox only the owner
 * and explicit full-lens grantees are in the audience — admins are capped at
 * metadata and the floor is `none` by construction (fail closed even if the
 * floor were misconfigured).
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
      if (entry.lens === 'full') audience.add(entry.userId)
    }
    return [...audience]
  }

  if (inbox?.defaultLens === 'full') {
    for (const m of members) audience.add(m.userId)
    return [...audience]
  }

  for (const m of members) {
    const role = roleMap[m.userId]
    if (role === 'OWNER' || role === 'ADMIN') audience.add(m.userId)
  }
  for (const entry of grantIndex.inboxes[inboxId] ?? []) {
    if (entry.lens === 'full') audience.add(entry.userId)
  }
  return [...audience]
}
