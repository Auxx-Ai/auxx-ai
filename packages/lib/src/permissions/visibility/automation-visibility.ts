// packages/lib/src/permissions/visibility/automation-visibility.ts

import type { AutomationVisibility } from './context'

/**
 * Compose the org's `AUTOMATION_SYSTEM` viewer (§8.2) from the cached inboxes
 * shape — no per-user cache entry needed. Personal inboxes (§11) are the only
 * exclusion.
 *
 * HEADLESS PATH — reads no member capabilities by design (ingest, automation,
 * sequences and workflows write mail as the system). The exclusion survives the
 * marker→def swap without a def branch here: the merged `inboxes` cache spans
 * both inbox definitions and derives `isPersonal` from def membership OR the
 * legacy marker (plan 40 §3.4 / `InboxService.derivePersonal`), so a
 * `personal_inbox` instance stays out of `automationScope` before AND after
 * data migration 060. This is one of only two `personalInboxIds` producers.
 */
export async function getAutomationVisibility(
  organizationId: string
): Promise<AutomationVisibility> {
  // Lazy import to avoid a hard module cycle (cache providers import this module).
  const { getOrgCache } = await import('../../cache')
  const inboxes = await getOrgCache().get(organizationId, 'inboxes')

  const personalInboxIds: Record<string, true> = {}
  for (const inbox of inboxes) {
    if (inbox.isPersonal) personalInboxIds[inbox.id] = true
  }
  return { kind: 'automation', personalInboxIds }
}
