// apps/web/src/components/data-connectors/ui/mapping-tree.tsx
'use client'

import { useEffect, useMemo } from 'react'
import type { RouterOutputs } from '~/trpc/react'
import { rootPathCandidates, type SourcePath } from '../hooks/use-source-paths'
import { useStreamMutations } from '../hooks/use-stream-mutations'
import { MappingNode } from './mapping-node'

type Mapping = RouterOutputs['dataConnector']['listStreams'][number]['mappings'][number]

interface MappingTreeProps {
  connectorId: string
  streamId: string
  /** The stream key — the record noun for the unnamed array root. */
  streamKey: string
  /** The stream's mappings (loaded with the stream — plan 08 §3). */
  mappings: Mapping[]
  sourcePaths: SourcePath[]
  /** Promote a value row to the calc drill (the `field` panel). */
  onPromoteField: (mappingId: string, fieldKey: string) => void
}

/**
 * The unified mapping editor (plan 07). A single recursive walk over the source
 * schema: each {@link MappingNode} renders the subtree it owns, binding leaves to
 * target fields and promoting object/array branches into inline child mappings.
 * Replaces the old split source-tree + appended-fan-out model (sub-plan 05 §4).
 */
export function MappingTree({
  connectorId,
  streamId,
  streamKey,
  mappings: rows,
  sourcePaths,
  onPromoteField,
}: MappingTreeProps) {
  // Optimistic mapping mutations (instant toggles) with rollback — no refetch.
  const mutations = useStreamMutations(connectorId)
  const { setRootPath } = mutations

  // Valid root-path choices for the root mapping, derived from the source schema.
  const rootCandidates = useMemo(() => rootPathCandidates(sourcePaths), [sourcePaths])

  // Self-heal: the root mapping's rootPath is dictated by the schema root type, so
  // a stored value that isn't a valid candidate (e.g. `''` against an array root)
  // is corrected to the derived default. Guarded on a loaded schema so we never
  // clobber a real value while the schema is still fetching.
  useEffect(() => {
    if (sourcePaths.length === 0 || rootCandidates.length === 0) return
    for (const m of rows) {
      if (m.parentMappingId === null && !rootCandidates.includes(m.rootPath)) {
        setRootPath(streamId, m.id, rootCandidates[0])
      }
    }
  }, [rows, rootCandidates, sourcePaths, streamId, setRootPath])

  // Index mappings by id (for `absolutePrefix`) and by parent (the tree).
  const { byMappingId, childrenOf } = useMemo(() => {
    const byMappingId = new Map<string, Mapping>()
    const childrenOf = new Map<string | null, Mapping[]>()
    for (const m of rows) {
      byMappingId.set(m.id, m)
      const key = m.parentMappingId ?? null
      const list = childrenOf.get(key) ?? []
      list.push(m)
      childrenOf.set(key, list)
    }
    return { byMappingId, childrenOf }
  }, [rows])

  // Every stream is seeded with a root mapping on create, so this is normally
  // unreachable; keep a quiet guard in case a row is mid-delete.
  if (rows.length === 0) {
    return (
      <div className='px-3 py-2 text-xs text-muted-foreground'>No mappings for this stream.</div>
    )
  }

  const roots = childrenOf.get(null) ?? []
  return (
    <div className='flex flex-col py-1'>
      {roots.map((m) => (
        <MappingNode
          key={m.id}
          mapping={m}
          depth={0}
          streamId={streamId}
          streamKey={streamKey}
          sourcePaths={sourcePaths}
          rootCandidates={rootCandidates}
          byMappingId={byMappingId}
          childrenOf={childrenOf}
          mutations={mutations}
          onPromoteField={onPromoteField}
        />
      ))}
    </div>
  )
}
