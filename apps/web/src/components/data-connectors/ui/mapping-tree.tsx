// apps/web/src/components/data-connectors/ui/mapping-tree.tsx
'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import TreeRow, { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Fingerprint, FunctionSquare, Hash, Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import { leafPathsUnder, type SourcePath } from '../hooks/use-source-paths'
import { type TargetDef, useTargetDefs } from '../hooks/use-target-defs'

type Mapping = NonNullable<
  ReturnType<typeof api.dataConnector.listMappings.useQuery>['data']
>[number]

const MERGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'overwrite', label: 'overwrite' },
  { value: 'fill_blank', label: 'fill-blank' },
  { value: 'connector_owned_only', label: 'owned-only' },
  { value: 'manual_review', label: 'review' },
  { value: 'ignore', label: 'ignore' },
]

interface MappingTreeProps {
  streamId: string
  sourcePaths: SourcePath[]
  /** Promote a value row to the calc drill (the `field` panel). */
  onPromoteField: (mappingId: string, fieldKey: string) => void
}

/**
 * Layer B — the mapping fan-out tree (05 §4). One `TreeRow` tree keyed by source
 * subtree (`rootPath`), parent→child via `parentMappingId`. Mapping rows carry
 * persistent colour-coded mode toggles (link mode · target mode) + an identity
 * chip; value rows carry inline source + merge pickers and a hover `ƒ` promote.
 */
export function MappingTree({ streamId, sourcePaths, onPromoteField }: MappingTreeProps) {
  const utils = api.useUtils()
  const { defs, byId } = useTargetDefs()
  const mappings = api.dataConnector.listMappings.useQuery({ streamId })
  const rows = mappings.data ?? []

  const invalidate = () => void utils.dataConnector.listMappings.invalidate({ streamId })
  const onErr = (verb: string) => (e: { message: string }) =>
    toastError({ title: `Could not ${verb}`, description: e.message })

  const setMappingTarget = api.dataConnector.setMappingTarget.useMutation({
    onSuccess: invalidate,
    onError: onErr('change target'),
  })
  const removeMapping = api.dataConnector.removeMapping.useMutation({
    onSuccess: invalidate,
    onError: onErr('remove mapping'),
  })
  const setFieldMappings = api.dataConnector.setFieldMappings.useMutation({
    onSuccess: invalidate,
    onError: onErr('save field'),
  })
  const setMergeStrategies = api.dataConnector.setMergeStrategies.useMutation({
    onSuccess: invalidate,
    onError: onErr('save merge strategy'),
  })
  const setIdentityStrategy = api.dataConnector.setIdentityStrategy.useMutation({
    onSuccess: invalidate,
    onError: onErr('save identity'),
  })

  // Build the parent→children tree from parentMappingId.
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Mapping[]>()
    for (const m of rows) {
      const key = m.parentMappingId ?? null
      const list = map.get(key) ?? []
      list.push(m)
      map.set(key, list)
    }
    return map
  }, [rows])

  if (mappings.isLoading) {
    return <div className='px-3 py-2 text-xs text-muted-foreground'>Loading mappings…</div>
  }
  if (rows.length === 0) {
    return (
      <div className='px-3 py-2 text-xs text-muted-foreground'>
        No mappings yet. Generate a schema and the connector seeds mappings, or add one.
      </div>
    )
  }

  const renderMapping = (mapping: Mapping, depth: number) => {
    const def = byId.get(mapping.entityDefinitionId)
    const linkMode = mapping.linkMode as 'upsert' | 'reference'
    const targetMode = mapping.targetMode as 'owned' | 'contributing'
    const fieldMappings = (mapping.fieldMappings ?? {}) as Record<
      string,
      { expression: string; sourceFields: Record<string, string> }
    >
    const mergeStrategies = (mapping.mergeStrategies ?? {}) as Record<string, string>
    const leaves = leafPathsUnder(sourcePaths, mapping.rootPath)
    const children = childrenOf.get(mapping.id) ?? []

    const toggleLinkMode = () =>
      setMappingTarget.mutate({
        mappingId: mapping.id,
        entityDefinitionId: mapping.entityDefinitionId,
        targetMode,
        linkMode: linkMode === 'upsert' ? 'reference' : 'upsert',
      })
    const toggleTargetMode = () =>
      setMappingTarget.mutate({
        mappingId: mapping.id,
        entityDefinitionId: mapping.entityDefinitionId,
        targetMode: targetMode === 'owned' ? 'contributing' : 'owned',
        linkMode,
      })

    return (
      <TreeRow
        key={mapping.id}
        depth={depth}
        expandable
        isOpen
        icon={<EntityIcon iconId={def?.icon ?? 'table'} size='xs' />}
        title={
          <span className='flex items-center gap-1.5'>
            <span className='font-mono text-xs text-muted-foreground'>
              {mapping.rootPath || 'root'}
            </span>
            <span className='text-muted-foreground'>→</span>
            <TargetDefCombobox
              defs={defs}
              value={mapping.entityDefinitionId}
              onChange={(entityDefinitionId) =>
                setMappingTarget.mutate({
                  mappingId: mapping.id,
                  entityDefinitionId,
                  targetMode,
                  linkMode,
                })
              }
            />
          </span>
        }
        trailing={
          <div className='flex items-center gap-1'>
            <IdentityChip
              mapping={mapping}
              leaves={leaves}
              def={def}
              onSave={(identityStrategy) =>
                setIdentityStrategy.mutate({ mappingId: mapping.id, identityStrategy })
              }
            />
            <TreeRowButton
              variant={linkMode}
              tooltipText={
                linkMode === 'upsert'
                  ? 'Upsert — create/update the record. Click to switch to reference (link only).'
                  : 'Reference — link only, no writes. Click to switch to upsert.'
              }
              onClick={toggleLinkMode}>
              <span className='px-1 text-[10px] font-medium'>{linkMode}</span>
            </TreeRowButton>
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
            <TreeRowButton
              variant='destructive'
              tooltipText='Remove mapping'
              onClick={() => removeMapping.mutate({ mappingId: mapping.id })}>
              <Trash2 />
            </TreeRowButton>
          </div>
        }>
        {/* Value rows (upsert) or a single reference row (reference). */}
        {linkMode === 'reference' ? (
          <ReferenceRow depth={depth + 1} mapping={mapping} def={def} leaves={leaves} />
        ) : (
          Object.entries(fieldMappings).map(([fieldKey, fm]) => (
            <ValueRow
              key={fieldKey}
              depth={depth + 1}
              fieldKey={fieldKey}
              fieldLabel={def?.fields.find((f) => f.key === fieldKey)?.label ?? fieldKey}
              expression={fm.expression}
              isCalc={!isBareToken(fm.expression)}
              leaves={leaves}
              mergeStrategy={mergeStrategies[fieldKey] ?? 'overwrite'}
              onPickSource={(path) => {
                const next = {
                  ...fieldMappings,
                  [fieldKey]: { expression: `{${path}}`, sourceFields: { [path]: path } },
                }
                setFieldMappings.mutate({ mappingId: mapping.id, fieldMappings: next })
              }}
              onMergeChange={(value) =>
                setMergeStrategies.mutate({
                  mappingId: mapping.id,
                  mergeStrategies: { ...mergeStrategies, [fieldKey]: value },
                })
              }
              onPromote={() => onPromoteField(mapping.id, fieldKey)}
            />
          ))
        )}

        {/* rels: caption from nested mappings. */}
        {children.length > 0 && (
          <div
            style={{ paddingLeft: `${(depth + 1) * 1.5}rem` }}
            className='px-1 py-1 text-[11px] text-muted-foreground'>
            rels:{' '}
            {children
              .map(
                (c) =>
                  `${c.rootPath || 'child'} → ${byId.get(c.entityDefinitionId)?.label ?? 'def'}`
              )
              .join(' · ')}
          </div>
        )}

        {/* Recurse nested mappings. */}
        {children.map((child) => renderMapping(child, depth + 1))}
      </TreeRow>
    )
  }

  const roots = childrenOf.get(null) ?? []
  return <div className='flex flex-col py-1'>{roots.map((m) => renderMapping(m, 0))}</div>
}

// ── Sub-rows ──────────────────────────────────────────────────────────────────

function ValueRow({
  depth,
  fieldKey,
  fieldLabel,
  expression,
  isCalc,
  leaves,
  mergeStrategy,
  onPickSource,
  onMergeChange,
  onPromote,
}: {
  depth: number
  fieldKey: string
  fieldLabel: string
  expression: string
  isCalc: boolean
  leaves: SourcePath[]
  mergeStrategy: string
  onPickSource: (path: string) => void
  onMergeChange: (value: string) => void
  onPromote: () => void
}) {
  const currentToken = isCalc ? null : expression.replace(/^\{|\}$/g, '')
  return (
    <TreeRow
      depth={depth}
      icon={<Hash className='size-3.5' />}
      title={<span className='text-sm'>{fieldLabel}</span>}
      trailing={
        <div className='flex items-center gap-1'>
          {isCalc ? (
            <span className='font-mono text-[11px] text-violet-600'>ƒ {expression}</span>
          ) : (
            <Select value={currentToken ?? ''} onValueChange={onPickSource}>
              <SelectTrigger size='sm' className='h-6 min-w-[120px] text-xs'>
                <SelectValue placeholder='source…' />
              </SelectTrigger>
              <SelectContent>
                {leaves.map((p) => (
                  <SelectItem key={p.path} value={p.path}>
                    {p.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
          <TreeRowButton persistent={isCalc} tooltipText='Edit as a formula' onClick={onPromote}>
            <FunctionSquare />
          </TreeRowButton>
        </div>
      }
    />
  )
}

function ReferenceRow({
  depth,
  mapping,
  def,
  leaves,
}: {
  depth: number
  mapping: Mapping
  def: TargetDef | undefined
  leaves: SourcePath[]
}) {
  // Reference rows resolve inline (no drill): "→ resolve [Resource] by [{source.id}]".
  const sourceId = leaves[0]?.path ?? 'id'
  return (
    <TreeRow
      depth={depth}
      icon={<Hash className='size-3.5' />}
      title={
        <span className='text-sm text-muted-foreground'>
          → resolve <span className='font-medium text-foreground'>{def?.label ?? 'record'}</span> by{' '}
          <span className='font-mono text-xs'>{`{${sourceId}}`}</span>
        </span>
      }
      secondary='if-unresolved: skip'
    />
  )
}

function TargetDefCombobox({
  defs,
  value,
  onChange,
}: {
  defs: TargetDef[]
  value: string
  onChange: (entityDefinitionId: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size='sm' className='h-6 min-w-[120px] text-xs'>
        <SelectValue placeholder='Target def…' />
      </SelectTrigger>
      <SelectContent>
        {defs.map((d) => (
          <SelectItem key={d.entityDefinitionId} value={d.entityDefinitionId}>
            {d.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function IdentityChip({
  mapping,
  leaves,
  def,
  onSave,
}: {
  mapping: Mapping
  leaves: SourcePath[]
  def: TargetDef | undefined
  onSave: (
    identityStrategy:
      | { kind: 'connectorExternalId' }
      | {
          kind: 'matchField'
          connectorFieldKey: string
          targetFieldId: string
          normalize?: 'email' | 'phone' | 'domain' | 'none'
        }
      | { kind: 'manualReview' }
  ) => void
}) {
  const identity = mapping.identityStrategy as { kind: string; connectorFieldKey?: string }
  const label =
    identity.kind === 'matchField'
      ? `id: ${identity.connectorFieldKey}`
      : identity.kind === 'connectorExternalId'
        ? 'id: external'
        : identity.kind === 'manualReview'
          ? 'id: review'
          : 'id'

  const identifierFields = def?.fields.filter((f) => f.isIdentifier) ?? []

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          className='inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-primary-50'>
          <Fingerprint className='size-3' />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-72'>
        <div className='flex flex-col gap-3'>
          <div className='text-xs font-medium uppercase text-muted-foreground'>Identity</div>
          <Select
            value={identity.kind}
            onValueChange={(kind) => {
              if (kind === 'connectorExternalId') onSave({ kind: 'connectorExternalId' })
              else if (kind === 'manualReview') onSave({ kind: 'manualReview' })
              else if (kind === 'matchField') {
                onSave({
                  kind: 'matchField',
                  connectorFieldKey: leaves[0]?.path ?? '',
                  targetFieldId: identifierFields[0]?.id ?? '',
                  normalize: 'none',
                })
              }
            }}>
            <SelectTrigger size='sm'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='matchField'>Match a field</SelectItem>
              <SelectItem value='connectorExternalId'>By connector id</SelectItem>
              <SelectItem value='manualReview'>Manual review</SelectItem>
            </SelectContent>
          </Select>

          {identity.kind === 'matchField' && (
            <div className='flex flex-col gap-2'>
              <span className='text-xs text-muted-foreground'>Source field</span>
              <Select
                value={identity.connectorFieldKey ?? ''}
                onValueChange={(connectorFieldKey) => {
                  const current = identity as {
                    targetFieldId?: string
                    normalize?: 'email' | 'phone' | 'domain' | 'none'
                  }
                  onSave({
                    kind: 'matchField',
                    connectorFieldKey,
                    targetFieldId: current.targetFieldId ?? identifierFields[0]?.id ?? '',
                    normalize: current.normalize ?? 'none',
                  })
                }}>
                <SelectTrigger size='sm'>
                  <SelectValue placeholder='Source field…' />
                </SelectTrigger>
                <SelectContent>
                  {leaves.map((p) => (
                    <SelectItem key={p.path} value={p.path}>
                      {p.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** A degenerate single-token `{path}` expression (one-click row, not a calc). */
function isBareToken(expression: string): boolean {
  return /^\{[^{}]+\}$/.test(expression.trim())
}

export { Plus }
