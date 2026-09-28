// packages/lib/src/inventory/builds/kind-conflicts.ts
// The kind-conflict read (plans/mrp/17-stock-setup-flow.md D3, §8). Reads only; no access checks.

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { readSystemRecords, systemFields } from '../../resources/system-records'
import { guard } from './guard'
import {
  type KindConflict,
  kindConflictFor,
  resolveKindForConflict,
  suggestedKindFor,
} from './kind-conflict-policy'

const PART_PICK = pickSystemAttributes(PART_FIELDS, [
  'part_kind',
  'part_kind_conflict_confirmed',
] as const)

/** Which parts sit inside a BOM, which have one, and the parents of each child. */
export interface KindConflictEdges {
  children: Set<string>
  parents: Set<string>
  parentsOf: Map<string, string[]>
}

/** The live BOM edges, from the same `subpartEdges` org cache the MRP reads use. */
export async function readKindConflictEdges(organizationId: string): Promise<KindConflictEdges> {
  const edges = (await getOrgCache().get(organizationId, 'subpartEdges')) ?? []
  const children = new Set<string>()
  const parents = new Set<string>()
  const parentsOf = new Map<string, string[]>()
  for (const edge of edges) {
    children.add(edge.childPartId)
    parents.add(edge.parentPartId)
    const list = parentsOf.get(edge.childPartId)
    if (!list) parentsOf.set(edge.childPartId, [edge.parentPartId])
    else if (!list.includes(edge.parentPartId)) list.push(edge.parentPartId)
  }
  return { children, parents, parentsOf }
}

/**
 * Parts whose kind disagrees with their BOM edges: a Finished Good used inside another part, or a
 * Component with its own BOM. Services and confirmed parts are excluded; archived parts too.
 * `partIds` narrows the answer, it does not widen it.
 */
export async function readKindConflicts(
  db: Database,
  organizationId: string,
  opts: { partIds?: string[] } = {}
): Promise<Result<KindConflict[], Error>> {
  return guard(
    async () => {
      const ctx = await systemFields(db, organizationId, 'part', PART_PICK)
      if (!ctx?.fields.part_kind) return []

      const edges = await readKindConflictEdges(organizationId)
      const scope = opts.partIds ? new Set(opts.partIds) : null
      // Only a part with a BOM edge can conflict.
      const candidates = [...new Set([...edges.children, ...edges.parents])].filter(
        (partId) => !scope || scope.has(partId)
      )
      if (candidates.length === 0) return []

      const ids = new Set(candidates)
      for (const partId of candidates) {
        for (const parentId of edges.parentsOf.get(partId) ?? []) ids.add(parentId)
      }
      const rows = await readSystemRecords(db, organizationId, ctx, { ids: [...ids] })
      const byId = new Map(rows.map((row) => [row.id, row]))

      const conflicts: KindConflict[] = []
      for (const partId of candidates) {
        const row = byId.get(partId)
        if (!row) continue
        const facts = {
          kind: row.option('part_kind'),
          isSubpartOfAssembly: edges.children.has(partId),
          hasBom: edges.parents.has(partId),
          confirmed: row.boolean('part_kind_conflict_confirmed') === true,
        }
        const reason = kindConflictFor(facts)
        if (!reason) continue
        conflicts.push({
          partId,
          partName: row.displayName,
          kind: resolveKindForConflict(facts.kind),
          reason,
          usedIn: (edges.parentsOf.get(partId) ?? [])
            .filter((parentId) => byId.has(parentId))
            .map((parentId) => ({
              partId: parentId,
              partName: byId.get(parentId)?.displayName ?? null,
            })),
          suggestedKind: suggestedKindFor({ reason, ...facts }),
        })
      }
      return conflicts.sort((a, b) => (a.partName ?? '').localeCompare(b.partName ?? ''))
    },
    'Failed to read part kind conflicts',
    { organizationId, partIds: opts.partIds?.length }
  )
}

/** BOM facts per part for the app's D4 confirm, from the same edges the conflict read uses. */
export async function readKindConflictFacts(
  organizationId: string,
  partIds: string[]
): Promise<Result<{ partId: string; isSubpartOfAssembly: boolean; hasBom: boolean }[], Error>> {
  return guard(
    async () => {
      const edges = await readKindConflictEdges(organizationId)
      return [...new Set(partIds)].map((partId) => ({
        partId,
        isSubpartOfAssembly: edges.children.has(partId),
        hasBom: edges.parents.has(partId),
      }))
    },
    'Failed to read part kind facts',
    { organizationId, partIds: partIds.length }
  )
}
