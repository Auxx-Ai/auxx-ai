// apps/web/src/components/data-connectors/ui/mapping-node.tsx
'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import { EntityIcon } from '@auxx/ui/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import TreeRow, { TreeRowButton } from '@auxx/ui/components/tree-row'
import { FunctionSquare, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { useResourceFields, useResourceProperty } from '~/components/resources'
import type { RouterOutputs } from '~/trpc/react'
import {
  absolutePrefix,
  buildSourceTree,
  type SourcePath,
  type SourceTreeNode,
  subtreeUnder,
} from '../hooks/use-source-paths'
import type { useStreamMutations } from '../hooks/use-stream-mutations'
import { BranchRow } from './branch-row'
import { MERGE_OPTIONS, SourceLeafRow } from './source-leaf-row'

/** Sentinel for the whole-payload root (`''`) — Radix Select forbids empty values. */
const ROOT_SENTINEL = '__root__'

type Mapping = RouterOutputs['dataConnector']['listStreams'][number]['mappings'][number]

/** One target-field binding. `match` flags it as a secondary identity key. */
type FieldMapping = {
  expression: string
  sourceFields: Record<string, string>
  match?: { normalize?: 'email' | 'phone' | 'domain' | 'none' }
}

/** Naive singularizer for record nouns (`todos → todo`, `line_items → line item`). */
function singularize(word: string): string {
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y')
  if (/(ss|sis|us)$/.test(word)) return word // address, analysis, status
  if (/s$/.test(word)) return word.replace(/s$/, '')
  return word
}

/** A source segment → a lowercase singular noun (`line_items[]` → `line item`). */
function recordNoun(raw: string): string {
  return singularize(raw.replace(/\[\]$/, '')).replace(/[_-]+/g, ' ').toLowerCase().trim()
}

/**
 * Plain-language description of where a mapping's records come from, derived from
 * the defined source schema. A named branch borrows its field name (`draft` →
 * "each draft"); the unnamed array ROOT (`[]`) has no schema name, so it falls
 * back to the stream's own noun (stream key `todos` → "each todo").
 */
function describeRootPath(rootPath: string, fallbackNoun?: string): string {
  if (rootPath === '') return 'whole payload'
  const seg = rootPath.replace(/\[\]$/, '').split('.').pop()
  if (seg) return `each ${recordNoun(seg)}`
  return fallbackNoun ? `each ${recordNoun(fallbackNoun)}` : 'each item'
}

/** A degenerate single-token `{path}` expression (one-click row, not a calc). */
function isBareToken(expression: string): boolean {
  return /^\{[^{}]+\}$/.test(expression.trim())
}

/** The fan-out rootPath for a branch node — arrays keep their `[]` suffix. */
function branchRootPath(node: SourceTreeNode): string {
  return node.type === 'array' ? `${node.path}[]` : node.path
}

export interface MappingNodeProps {
  mapping: Mapping
  depth: number
  streamId: string
  /** The stream key — the record noun for the unnamed array root (`[]`). */
  streamKey: string
  /** Payload-absolute source paths (Layer A schema), shared by the whole tree. */
  sourcePaths: SourcePath[]
  /** Root-mapping rootPath choices (only meaningful for the root). */
  rootCandidates: string[]
  /** All mappings indexed by id — for `absolutePrefix` + child lookup. */
  byMappingId: Map<string, Mapping>
  childrenOf: Map<string | null, Mapping[]>
  mutations: ReturnType<typeof useStreamMutations>
  onPromoteField: (mappingId: string, fieldKey: string) => void
}

/**
 * One `DataConnectorMapping` rendered as the source-schema subtree it owns (plan
 * §3.3). The header carries the target def + target mode toggle; identity
 * is configured per-leaf (the "Match" toggle), not in the header. The body
 * walks the mapping's subtree (sliced by {@link absolutePrefix} — the nesting-bug
 * fix) and, at each node, either binds a leaf, offers a branch action menu, or —
 * when a child mapping exists at that branch — recurses inline as the child
 * `MappingNode`. No separate appended child block.
 */
export function MappingNode({
  mapping,
  depth,
  streamId,
  streamKey,
  sourcePaths,
  rootCandidates,
  byMappingId,
  childrenOf,
  mutations,
  onPromoteField,
}: MappingNodeProps) {
  const [open, setOpen] = useState(true)
  const {
    setMappingTarget,
    setRootPath,
    removeMapping,
    setFieldMappings,
    setMergeStrategies,
    fanOut,
  } = mutations

  // Target def display + fields, read from the resource store (the same source
  // the ResourcePicker/FieldPicker use) — no parallel projection needed.
  const resource = useResourceProperty(mapping.entityDefinitionId, ['icon', 'label'])
  const { fields: targetFields } = useResourceFields(mapping.entityDefinitionId)
  const linkMode = mapping.linkMode as 'upsert' | 'reference'
  const targetMode = mapping.targetMode as 'owned' | 'contributing'
  const fieldMappings = (mapping.fieldMappings ?? {}) as Record<string, FieldMapping>
  const mergeStrategies = (mapping.mergeStrategies ?? {}) as Record<string, string>

  // Target field keys flagged as secondary identity-match keys (external id is
  // always the primary). The blue "Match" badges on leaves reflect this set.
  const matchKeys = new Set(
    Object.entries(fieldMappings)
      .filter(([, fm]) => fm.match)
      .map(([k]) => k)
  )

  // Slice this mapping's subtree by its FULL absolute prefix (not the bare,
  // parent-relative rootPath) so nested mappings render the correct subtree.
  const prefix = absolutePrefix(mapping, byMappingId)
  const relativeSubtree = subtreeUnder(sourcePaths, prefix)
  const sourceTree = buildSourceTree(relativeSubtree)
  const branchPaths = new Set(relativeSubtree.filter((p) => p.isBranch).map((p) => p.path))

  // Child mappings indexed by their (array-normalized) rootPath segment, so a
  // branch node at `line_items` matches a child mapping with rootPath
  // `line_items[]`.
  const childMappings = childrenOf.get(mapping.id) ?? []
  const childByNodePath = new Map<string, Mapping>()
  for (const c of childMappings) childByNodePath.set(c.rootPath.replace(/\[\]$/, ''), c)
  // Children whose branch isn't in the current schema (e.g. schema regenerated)
  // would otherwise vanish — render them appended so they stay editable/removable.
  const orphanChildren = childMappings.filter(
    (c) => !branchPaths.has(c.rootPath.replace(/\[\]$/, ''))
  )

  // Reverse-index bare-token field mappings: source path → target field key.
  const sourceToTarget = new Map<string, string>()
  for (const [targetKey, fm] of Object.entries(fieldMappings)) {
    if (isBareToken(fm.expression))
      sourceToTarget.set(fm.expression.replace(/^\{|\}$/g, ''), targetKey)
  }

  // Non-bare entries are computed target fields — they get their own rows below
  // the source leaves (a multi-source formula has no single leaf to anchor on).
  const formulaEntries = Object.entries(fieldMappings).filter(
    ([, fm]) => !isBareToken(fm.expression)
  )

  const assignTarget = (sourcePath: string, targetKey: string) => {
    const next = { ...fieldMappings }
    // Drop any prior target bound to this source (1 source → 1 target).
    for (const [k, fm] of Object.entries(next)) {
      if (isBareToken(fm.expression) && fm.expression.replace(/^\{|\}$/g, '') === sourcePath) {
        delete next[k]
      }
    }
    next[targetKey] = { expression: `{${sourcePath}}`, sourceFields: { [sourcePath]: sourcePath } }
    setFieldMappings(streamId, mapping.id, next)
  }
  const clearTarget = (targetKey: string) => {
    const next = { ...fieldMappings }
    delete next[targetKey]
    setFieldMappings(streamId, mapping.id, next)
  }

  // Normalizer for a match key, derived from the target field's storage type so
  // the toggle stays one-click (no normalize selector).
  const deriveNormalize = (targetKey: string): 'email' | 'phone' | 'domain' | 'none' => {
    const ft = targetFields.find((f) => f.key === targetKey)?.fieldType
    if (ft === 'EMAIL') return 'email'
    if (ft === 'PHONE_INTL') return 'phone'
    if (ft === 'URL') return 'domain'
    return 'none'
  }
  // Flip a bound field's secondary-identity-match flag (rides the fieldMappings patch).
  const toggleMatch = (targetKey: string) => {
    const fm = fieldMappings[targetKey]
    if (!fm) return
    const next = { ...fieldMappings }
    next[targetKey] = fm.match
      ? { expression: fm.expression, sourceFields: fm.sourceFields }
      : { ...fm, match: { normalize: deriveNormalize(targetKey) } }
    setFieldMappings(streamId, mapping.id, next)
  }

  const toggleTargetMode = () =>
    setMappingTarget(streamId, {
      mappingId: mapping.id,
      entityDefinitionId: mapping.entityDefinitionId,
      targetMode: targetMode === 'owned' ? 'contributing' : 'owned',
      linkMode,
    })

  // Materialize a child mapping at a branch (fan out → own def, upsert). The
  // reference (link-only) link mode stays in the schema/runtime but is not yet
  // exposed in the UI.
  const materializeChild = (node: SourceTreeNode, entityDefinitionId: string) =>
    fanOut(streamId, {
      parentMappingId: mapping.id,
      rootPath: branchRootPath(node),
      linkMode: 'upsert',
      targetMode: 'owned',
      entityDefinitionId,
      // relationshipFieldKey left null until provisioning wires the parent
      // relation field (plan §8.1).
      relationshipFieldKey: null,
    })

  return (
    <TreeRow
      depth={depth}
      expandable
      isOpen={open}
      onToggleOpen={() => setOpen((o) => !o)}
      icon={<EntityIcon iconId={resource?.icon ?? 'table'} size='xs' />}
      title={
        <span className='flex items-center gap-1.5'>
          {mapping.parentMappingId === null && rootCandidates.length > 1 ? (
            <span onClick={(e) => e.stopPropagation()}>
              <Select
                value={mapping.rootPath || ROOT_SENTINEL}
                onValueChange={(v) =>
                  setRootPath(streamId, mapping.id, v === ROOT_SENTINEL ? '' : v)
                }>
                <SelectTrigger size='sm' className='h-6 min-w-[120px] text-xs'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rootCandidates.map((p) => (
                    <SelectItem key={p || ROOT_SENTINEL} value={p || ROOT_SENTINEL}>
                      {describeRootPath(p, streamKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>
          ) : (
            <span className='text-xs text-muted-foreground'>
              {describeRootPath(mapping.rootPath, streamKey)}
            </span>
          )}
          <span className='text-muted-foreground'>→</span>
          {/* Stop clicks on the picker from bubbling to the row's toggle handler. */}
          <span onClick={(e) => e.stopPropagation()}>
            <ResourcePicker
              value={mapping.entityDefinitionId ? [mapping.entityDefinitionId] : []}
              onChange={() => {}}
              entityDefinedOnly
              emptyLabel='Target def…'
              onSelectSingle={(entityDefinitionId) =>
                setMappingTarget(streamId, {
                  mappingId: mapping.id,
                  entityDefinitionId,
                  targetMode,
                  linkMode,
                })
              }
              triggerProps={{ variant: 'outline', className: 'h-6 min-w-[120px] text-xs' }}
            />
          </span>
        </span>
      }
      secondary={
        <div className='flex items-center gap-1'>
          <TreeRowButton
            variant={targetMode}
            tooltipText={
              targetMode === 'owned'
                ? 'Owned — connector manages this def (archive on orphan). Click to switch to contributing.'
                : 'Contributing — writes into a pre-existing def per-field, never archives. Click to switch to owned.'
            }
            onClick={toggleTargetMode}>
            <span className='px-1 text-[10px] font-medium'>{targetMode}</span>
          </TreeRowButton>
          {/* The root mapping is the stream's spine (seeded on create) — it can't
              be removed (delete the stream instead). Only fan-out children are. */}
          {mapping.parentMappingId !== null && (
            <TreeRowButton
              variant='destructive'
              tooltipText='Remove mapping'
              onClick={() => removeMapping(streamId, mapping.id)}>
              <Trash2 />
            </TreeRowButton>
          )}
        </div>
      }>
      {sourceTree.length === 0 ? (
        <div
          style={{ paddingLeft: `${(depth + 1) * 1.5}rem` }}
          className='px-1 py-1 text-[11px] text-muted-foreground'>
          No source schema yet — generate or edit the schema above to map fields.
        </div>
      ) : (
        sourceTree.map((node) => (
          <SourceNode
            key={node.path}
            node={node}
            depth={depth + 1}
            mapping={mapping}
            targetMode={targetMode}
            targetFields={targetFields}
            sourceToTarget={sourceToTarget}
            mergeStrategies={mergeStrategies}
            matchKeys={matchKeys}
            childByNodePath={childByNodePath}
            onAssign={assignTarget}
            onClear={clearTarget}
            onMergeChange={(targetKey, value) =>
              setMergeStrategies(streamId, mapping.id, { ...mergeStrategies, [targetKey]: value })
            }
            onToggleMatch={toggleMatch}
            onFanOut={materializeChild}
            // Child-mapping recursion context.
            streamId={streamId}
            streamKey={streamKey}
            sourcePaths={sourcePaths}
            rootCandidates={rootCandidates}
            byMappingId={byMappingId}
            childrenOf={childrenOf}
            mutations={mutations}
            onPromoteField={onPromoteField}
          />
        ))
      )}

      {/* Formula rows — one per non-bare field mapping (a computed target field),
          plus an add row. Reference-mode mappings only link, so no formulas. */}
      {linkMode !== 'reference' && (
        <>
          {formulaEntries.map(([targetKey, fm]) => (
            <FormulaRow
              key={targetKey}
              depth={depth + 1}
              label={targetFields.find((f) => f.key === targetKey)?.label ?? targetKey}
              expression={fm.expression}
              mergeStrategy={mergeStrategies[targetKey] ?? 'overwrite'}
              onEdit={() => onPromoteField(mapping.id, targetKey)}
              onMergeChange={(value) =>
                setMergeStrategies(streamId, mapping.id, { ...mergeStrategies, [targetKey]: value })
              }
              onClear={() => clearTarget(targetKey)}
            />
          ))}
          {mapping.entityDefinitionId != null && (
            <TreeRow
              depth={depth + 1}
              icon={<Plus className='size-3.5 text-muted-foreground/50' />}
              title={<span className='text-sm text-muted-foreground'>Add formula</span>}
              onToggleOpen={() => onPromoteField(mapping.id, '')}
            />
          )}
        </>
      )}

      {/* Child mappings whose branch isn't in the current schema — appended so
          they don't silently disappear (and stay removable). */}
      {orphanChildren.map((child) => (
        <MappingNode
          key={child.id}
          mapping={child}
          depth={depth + 1}
          streamId={streamId}
          sourcePaths={sourcePaths}
          rootCandidates={rootCandidates}
          byMappingId={byMappingId}
          childrenOf={childrenOf}
          mutations={mutations}
          onPromoteField={onPromoteField}
          streamKey={streamKey}
        />
      ))}
    </TreeRow>
  )
}

// ── Recursive source-subtree node ──────────────────────────────────────────────

interface SourceNodeProps {
  node: SourceTreeNode
  depth: number
  /** The enclosing mapping (binding target for leaves under it). */
  mapping: Mapping
  targetMode: 'owned' | 'contributing'
  targetFields: ResourceField[]
  sourceToTarget: Map<string, string>
  mergeStrategies: Record<string, string>
  /** Target keys flagged as secondary identity-match keys. */
  matchKeys: Set<string>
  childByNodePath: Map<string, Mapping>
  onAssign: (sourcePath: string, targetKey: string) => void
  onClear: (targetKey: string) => void
  onMergeChange: (targetKey: string, value: string) => void
  onToggleMatch: (targetKey: string) => void
  onFanOut: (node: SourceTreeNode, entityDefinitionId: string) => void
  // Child-mapping recursion context (forwarded to a nested MappingNode).
  streamId: string
  streamKey: string
  sourcePaths: SourcePath[]
  rootCandidates: string[]
  byMappingId: Map<string, Mapping>
  childrenOf: Map<string | null, Mapping[]>
  mutations: ReturnType<typeof useStreamMutations>
  onPromoteField: (mappingId: string, fieldKey: string) => void
}

/**
 * One node of a mapping's source subtree (plan §3.3). Resolves to one of three
 * renders: a promoted child `MappingNode` (a child mapping exists at this
 * branch), an un-promoted {@link BranchRow} (object/array container + action
 * menu), or a {@link SourceLeafRow} (scalar / array-of-scalars binding).
 */
function SourceNode(props: SourceNodeProps) {
  const {
    node,
    depth,
    mapping,
    targetMode,
    targetFields,
    sourceToTarget,
    mergeStrategies,
    matchKeys,
    childByNodePath,
    onAssign,
    onClear,
    onMergeChange,
    onToggleMatch,
    onFanOut,
  } = props
  const [open, setOpen] = useState(true)

  // A child mapping at this branch → render it inline (promoted state).
  const childMapping = node.isBranch ? childByNodePath.get(node.path) : undefined
  if (childMapping) {
    return (
      <MappingNode
        mapping={childMapping}
        depth={depth}
        streamId={props.streamId}
        streamKey={props.streamKey}
        sourcePaths={props.sourcePaths}
        rootCandidates={props.rootCandidates}
        byMappingId={props.byMappingId}
        childrenOf={props.childrenOf}
        mutations={props.mutations}
        onPromoteField={props.onPromoteField}
      />
    )
  }

  if (node.isBranch) {
    return (
      <BranchRow
        depth={depth}
        node={node}
        isOpen={open}
        onToggleOpen={() => setOpen((o) => !o)}
        onFanOut={(entityDefinitionId) => onFanOut(node, entityDefinitionId)}>
        {node.children.map((child) => (
          <SourceNode key={child.path} {...props} node={child} depth={depth + 1} />
        ))}
      </BranchRow>
    )
  }

  const assignedTargetKey = sourceToTarget.get(node.path)
  const assignedLabel = assignedTargetKey
    ? targetFields.find((f) => f.key === assignedTargetKey)?.label
    : undefined
  return (
    <SourceLeafRow
      depth={depth}
      node={node}
      entityDefinitionId={mapping.entityDefinitionId}
      assignedLabel={assignedLabel}
      assignedTargetKey={assignedTargetKey}
      canCreate={targetMode === 'owned'}
      isMatch={assignedTargetKey ? matchKeys.has(assignedTargetKey) : false}
      mergeStrategy={
        assignedTargetKey ? (mergeStrategies[assignedTargetKey] ?? 'overwrite') : 'overwrite'
      }
      onAssign={(targetKey) => onAssign(node.path, targetKey)}
      onClear={() => assignedTargetKey && onClear(assignedTargetKey)}
      onMergeChange={(value) => assignedTargetKey && onMergeChange(assignedTargetKey, value)}
      onToggleMatch={() => assignedTargetKey && onToggleMatch(assignedTargetKey)}
    />
  )
}

// ── Formula row (a computed target field) ──────────────────────────────────────

interface FormulaRowProps {
  depth: number
  /** Target field label this formula writes into. */
  label: string
  /** The calc expression (shown as a preview; click the row to edit). */
  expression: string
  mergeStrategy: string
  onEdit: () => void
  onMergeChange: (value: string) => void
  onClear: () => void
}

/**
 * A computed target field (plan 10 §3.2) — a non-bare `fieldMappings` entry that
 * can reference many source fields, so it lives on its own row rather than on a
 * source leaf. Clicking the row opens the calc editor; it carries a merge
 * strategy (it writes a target field) but no Match toggle (no single source path
 * to match identity on).
 */
function FormulaRow({
  depth,
  label,
  expression,
  mergeStrategy,
  onEdit,
  onMergeChange,
  onClear,
}: FormulaRowProps) {
  return (
    <TreeRow
      depth={depth}
      icon={<FunctionSquare className='size-3.5' />}
      title={<span className='text-sm'>{label}</span>}
      secondary={<span className='font-mono text-xs'>← {expression}</span>}
      onToggleOpen={onEdit}
      trailing={
        <div className='flex items-center gap-1'>
          <Select value={mergeStrategy} onValueChange={onMergeChange}>
            <SelectTrigger size='sm' className='h-6 min-w-[96px] text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MERGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TreeRowButton tooltipText='Remove formula' onClick={onClear}>
            <X />
          </TreeRowButton>
        </div>
      }
    />
  )
}
