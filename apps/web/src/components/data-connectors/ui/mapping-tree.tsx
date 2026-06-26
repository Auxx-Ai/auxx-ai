// apps/web/src/components/data-connectors/ui/mapping-tree.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Braces, Brackets, Hash, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ResourcePickerContent } from '~/components/pickers/resource-picker'
import { api, type RouterOutputs } from '~/trpc/react'
import {
  buildSourceTree,
  lastSegment,
  type SourcePath,
  type SourceTreeNode,
  subtreeUnder,
} from '../hooks/use-source-paths'
import { useStreamMutations } from '../hooks/use-stream-mutations'
import { BranchRow } from './branch-row'
import { CappedNodeList } from './capped-node-list'
import { MappingNode } from './mapping-node'
import { MappingRow } from './mapping-row'

type Mapping = RouterOutputs['dataConnector']['listStreams'][number]['mappings'][number]

interface MappingTreeProps {
  connectorId: string
  streamId: string
  /** The stream key — the record noun for the unnamed array root. */
  streamKey: string
  /** The stream's mappings (loaded with the stream — plan 08 §3). */
  mappings: Mapping[]
  sourcePaths: SourcePath[]
  /** The stream's raw source schema (Layer A) — fed to the Tier 2 suggester. */
  sourceSchema?: Record<string, unknown> | null
}

/** The fan-out rootPath for a branch node — arrays keep their `[]` suffix. */
function branchRootPath(node: SourceTreeNode): string {
  return node.type === 'array' ? `${node.path}[]` : node.path
}

/**
 * The unified mapping editor. The source schema (Layer A) is rendered as an
 * always-on tree — no mapping is seeded on stream create, so the tree is the
 * skeleton the user builds against. A "whole payload" root row sits at the top
 * (creating a mapping there treats the entire payload as one record); every
 * object/array branch beneath it can be promoted into its own mapping (e.g. the
 * `data[]` collection of a list envelope). A promoted branch re-renders as a
 * {@link MappingNode} that owns its subtree; un-promoted branches/leaves render
 * passively so the full payload shape stays visible at all times.
 */
export function MappingTree({
  connectorId,
  streamId,
  streamKey,
  mappings: rows,
  sourcePaths,
  sourceSchema,
}: MappingTreeProps) {
  const mutations = useStreamMutations(connectorId)
  const { fanOut } = mutations
  const [rootOpen, setRootOpen] = useState(true)

  // Which defs the WHOLE connector already syncs (not just this stream) — a soft
  // HINT the field picker uses to mark relationships whose related record is
  // already streamed elsewhere. Under def-keyed resolution (v3 §9.6) it is no longer
  // a hard gate: drilling a relationship lazily contributes to the related def. Read
  // from the shared `listStreams` cache the parent already populated — no extra fetch.
  const { data: allStreams } = api.dataConnector.listStreams.useQuery({ id: connectorId })
  const syncedDefIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of allStreams ?? []) {
      for (const m of s.mappings) {
        if (m.linkMode === 'reference' || !m.entityDefinitionId) continue
        ids.add(m.entityDefinitionId)
      }
    }
    return ids
  }, [allStreams])

  // The payload root type dictates the whole-payload rootPath: an array root fans
  // out per element (`[]`); an object root is a single record (`''`).
  const rootIsArray = useMemo(() => sourcePaths.some((p) => p.path.startsWith('[]')), [sourcePaths])
  const rootBase = rootIsArray ? '[]' : ''

  // Wizard's first state: not a single mapping exists anywhere in the tree. Drives
  // the empty-state affordances (root CTA + branch hints) that vanish the moment
  // the user creates any mapping.
  const isEmpty = rows.length === 0

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

  // Top-level mappings (no parent). A whole-payload mapping is the one rooted at
  // `rootBase`; the rest are branch mappings (e.g. `data[]`) keyed by their
  // array-normalized rootPath so a branch node at `data` matches `data[]`.
  const topLevel = childrenOf.get(null) ?? []
  const rootMapping = topLevel.find((m) => m.rootPath === rootBase)
  const branchMappingByPath = new Map<string, Mapping>()
  for (const m of topLevel) {
    if (m === rootMapping) continue
    branchMappingByPath.set(m.rootPath.replace(/\[\]$/, ''), m)
  }

  // The full source tree (relative to the payload root) — the always-on skeleton.
  const topTree = useMemo(
    () => buildSourceTree(subtreeUnder(sourcePaths, rootBase)),
    [sourcePaths, rootBase]
  )

  // Create a mapping straight off a source row: the whole-payload root, or a
  // branch (`data` → `data[]`). Top-level (no parent) since the root is unmapped;
  // contributing by default (the primary records sink writes into an existing def).
  const createMapping = (rootPath: string, entityDefinitionId: string) =>
    fanOut(streamId, {
      parentMappingId: null,
      rootPath,
      linkMode: 'upsert',
      targetMode: 'contributing',
      entityDefinitionId,
      relationshipFieldKey: null,
    })

  const recursionCtx = {
    connectorId,
    streamId,
    streamKey,
    sourceSchema,
    sourcePaths,
    byMappingId,
    childrenOf,
    mutations,
    syncedDefIds,
  }

  // A mapped whole-payload root owns the entire subtree (single-record source, or
  // an envelope the user chose to treat as one record) — render just that node.
  if (rootMapping) {
    return (
      <div className='flex flex-col py-1'>
        <MappingNode mapping={rootMapping} depth={0} {...recursionCtx} />
      </div>
    )
  }

  return (
    <div className='flex flex-col py-1'>
      <MappingRow
        depth={0}
        expandable
        chevronOnHover
        isOpen={rootOpen}
        onToggleOpen={() => setRootOpen((o) => !o)}
        icon={
          rootIsArray ? (
            <Brackets className='size-3.5 text-muted-foreground/60' />
          ) : (
            <Braces className='size-3.5 text-muted-foreground/60' />
          )
        }
        title={
          <span className='text-xs text-muted-foreground'>
            {rootIsArray ? `each ${streamKey || 'item'}` : 'whole payload'}
            {isEmpty && (
              <span className='ml-2 text-muted-foreground/50'>· map to a record to begin</span>
            )}
          </span>
        }
        actions={
          <CreateMappingAction
            tooltip='Map whole payload → own record'
            label={isEmpty ? 'Map record' : undefined}
            onPick={(defId) => createMapping(rootBase, defId)}
          />
        }>
        {topTree.length === 0 ? (
          <div className='px-3 py-2 text-[11px] text-muted-foreground'>
            No source schema yet — generate or edit the schema above to map fields.
          </div>
        ) : (
          <CappedNodeList
            nodes={topTree}
            childDepth={1}
            isCappable={(n) => !n.isBranch}
            renderNode={(node) => (
              <TopSourceNode
                key={node.path}
                node={node}
                depth={1}
                isEmpty={isEmpty}
                branchMappingByPath={branchMappingByPath}
                onCreate={createMapping}
                {...recursionCtx}
              />
            )}
          />
        )}
      </MappingRow>
    </div>
  )
}

// ── Top-level source node (no enclosing mapping) ───────────────────────────────

interface TopSourceNodeProps {
  node: SourceTreeNode
  depth: number
  /** No mapping exists anywhere yet — forwarded to branch rows for their hint/CTA. */
  isEmpty: boolean
  /** Top-level branch mappings keyed by array-normalized path (`data` → `data[]`). */
  branchMappingByPath: Map<string, Mapping>
  /** Create a top-level mapping at the given rootPath against the picked def. */
  onCreate: (rootPath: string, entityDefinitionId: string) => void
  // Recursion context forwarded to a promoted MappingNode.
  connectorId: string
  streamId: string
  streamKey: string
  sourceSchema?: Record<string, unknown> | null
  sourcePaths: SourcePath[]
  byMappingId: Map<string, Mapping>
  childrenOf: Map<string | null, Mapping[]>
  mutations: ReturnType<typeof useStreamMutations>
  syncedDefIds: Set<string>
}

/**
 * One node of the always-on source tree, rendered OUTSIDE any mapping. A branch
 * with a top-level mapping promotes to a {@link MappingNode}; an un-promoted
 * branch is a {@link BranchRow} with a create action; a leaf renders passively
 * (no enclosing mapping to bind it to until its branch is mapped).
 */
function TopSourceNode(props: TopSourceNodeProps) {
  const { node, depth, branchMappingByPath, onCreate } = props
  const [open, setOpen] = useState(true)

  if (node.isBranch) {
    const mapping = branchMappingByPath.get(node.path)
    if (mapping) {
      return (
        <MappingNode
          mapping={mapping}
          depth={depth}
          connectorId={props.connectorId}
          streamId={props.streamId}
          streamKey={props.streamKey}
          sourceSchema={props.sourceSchema}
          sourcePaths={props.sourcePaths}
          byMappingId={props.byMappingId}
          childrenOf={props.childrenOf}
          mutations={props.mutations}
          syncedDefIds={props.syncedDefIds}
        />
      )
    }
    return (
      <BranchRow
        depth={depth}
        node={node}
        isEmpty={props.isEmpty}
        isOpen={open}
        onToggleOpen={() => setOpen((o) => !o)}
        onFanOut={(defId) => onCreate(branchRootPath(node), defId)}>
        <CappedNodeList
          nodes={node.children}
          childDepth={depth + 1}
          isCappable={(n) => !n.isBranch}
          renderNode={(child) => (
            <TopSourceNode key={child.path} {...props} node={child} depth={depth + 1} />
          )}
        />
      </BranchRow>
    )
  }

  return <InertLeafRow depth={depth} node={node} />
}

/** A source leaf shown before its branch is mapped — display only, no binding. */
function InertLeafRow({ depth, node }: { depth: number; node: SourcePath }) {
  const Icon = node.type === 'array' ? Brackets : Hash
  return (
    <MappingRow
      depth={depth}
      icon={<Icon className='size-3.5 text-muted-foreground/40' />}
      title={
        <span className='flex items-center gap-1.5'>
          <span className='font-mono text-sm text-muted-foreground/70'>
            {lastSegment(node.path)}
          </span>
          <span className='text-[10px] uppercase text-muted-foreground/50'>{node.type}</span>
        </span>
      }
    />
  )
}

/** The "pick a def → create a mapping here" popover action (shared by root + branch).
 *  Pass `label` to render the prominent, always-visible CTA (empty state); omit it
 *  for the default hover-revealed icon button. */
function CreateMappingAction({
  tooltip,
  onPick,
  label,
}: {
  tooltip: string
  onPick: (entityDefinitionId: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {label ? (
          <Button variant='outline' size='xs'>
            <Plus />
            {label}
          </Button>
        ) : (
          <TreeRowButton tooltipText={tooltip}>
            <Plus />
          </TreeRowButton>
        )}
      </PopoverTrigger>
      <PopoverContent align='end' className='w-64 p-0'>
        <div className='border-b px-2 py-1.5 text-[10px] font-medium uppercase text-muted-foreground'>
          {tooltip}
        </div>
        <ResourcePickerContent
          value={[]}
          onChange={() => {}}
          onSelectSingle={(defId) => {
            onPick(defId)
            setOpen(false)
          }}
          entityDefinedOnly
          placeholder='Search entity definitions…'
        />
      </PopoverContent>
    </Popover>
  )
}
