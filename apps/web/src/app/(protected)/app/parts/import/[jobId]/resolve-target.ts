// apps/web/src/app/(protected)/app/parts/import/[jobId]/resolve-target.ts

import { findCachedResource } from '@auxx/lib/cache'
import {
  findNamedImporter,
  findNamedImporterByTarget,
  type NamedImporter,
} from '@auxx/lib/resources'
import { getSession } from '~/auth/session'

/** What {@link resolveNamedImporterTarget} decided about a `?target=` param. */
export interface ResolvedImporterTarget {
  /** The declaration, or null when the param named nothing this host offers. */
  importer: NamedImporter | null
  /**
   * True when `target` arrived in a NON-canonical form and the caller should
   * rewrite the URL to `importer.fieldKey`. False when it was already canonical
   * (or when nothing resolved and there is nothing to rewrite).
   */
  canonicalized: boolean
}

const NOTHING: ResolvedImporterTarget = { importer: null, canonicalized: false }

/**
 * Resolve a `?target=` param to the named importer it means.
 *
 * **One canonical language, tolerant at the edge.** The wire format is the
 * declaring FIELD KEY (`part_vendor_parts`) — stable across orgs, readable, and
 * the only form that can distinguish two importers pointing at one target def.
 * But a def id (`vendor_part`) or an org's EntityDefinition CUID is a perfectly
 * reasonable thing for a human, an old bookmark, or another caller to have in
 * hand, so those are resolved rather than refused. The caller then rewrites the
 * URL once, and everything downstream sees the canonical key.
 *
 * The ladder, cheapest first:
 *
 * 1. **Field key** — a synchronous static-registry lookup. The happy path costs
 *    no I/O at all, which is why this is the canonical form.
 * 2. **Def id or CUID** — resolved through the org cache (`findCachedResource`
 *    normalizes CUID / entityType / apiSlug in one read), then matched by target.
 *    ⚠️ Only reached when step 1 missed, so the common case never pays for it.
 *
 * 🛑 Refuses rather than guesses in two cases. An `'ambiguous'` verdict — two
 * importers declared onto the same target def — cannot be resolved from a def id
 * at all. And a target naming a def this host declares no importer for is
 * dropped: the query param must never become a way to start an import job
 * against a def the menu never offered, because a hidden def is not an
 * access-controlled one.
 *
 * @param hostDefId - The resource whose page hosts the importers
 * @param target - The raw `?target=` value, in any of the accepted forms
 * @returns The resolved importer and whether the URL needs canonicalizing
 */
export async function resolveNamedImporterTarget(
  hostDefId: string,
  target: string | undefined
): Promise<ResolvedImporterTarget> {
  if (!target) return NOTHING

  // 1. Canonical: the declaring field key. Synchronous, no I/O.
  const byKey = findNamedImporter(hostDefId, target)
  if (byKey) return { importer: byKey, canonicalized: false }

  // 2. Tolerated: a def id or CUID. Needs the org to normalize the keyspace,
  //    which is exactly why it is not the canonical form.
  const session = await getSession()
  const organizationId = session?.user?.defaultOrganizationId
  if (!organizationId) return NOTHING

  const resource = await findCachedResource(organizationId, target)
  if (!resource) return NOTHING

  // `entityType` is the static registry's keyspace; `id` is the org's. Try the
  // former, since that is what a declaration's relationship resolves to.
  const byTarget = findNamedImporterByTarget(hostDefId, resource.entityType ?? resource.id)
  if (!byTarget || byTarget === 'ambiguous') return NOTHING

  return { importer: byTarget, canonicalized: true }
}
