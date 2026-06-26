// apps/web/src/components/data-connectors/ui/mapping-field-picker.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeType } from '@auxx/database/types'
import { FIELD_TYPE_GROUPS, fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import type { ResourceField } from '@auxx/lib/resources/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { type FieldReference, type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { humanizeFieldPath } from '@auxx/utils'
import { ChevronDown, ChevronLeft, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { ComboPicker, type Option, type OptionGroup } from '~/components/pickers/combo-picker'
import { FieldPickerContent } from '~/components/pickers/field-picker'
import { useResourceFields } from '~/components/resources'
import { lastSegment } from '../hooks/use-source-paths'
import { isSourceTargetCompatible, isWritableTarget } from './field-type-compat'

/**
 * Infer a sensible create-field type from the source node. A detected string
 * `format` (from the test-fetch values) wins over the segment-name heuristic,
 * which only falls back when the format is absent.
 */
function inferFieldType(path: string, sourceType: string, format?: string): FieldTypeType {
  switch (format) {
    case 'email':
      return FieldType.EMAIL
    case 'uri':
      return FieldType.URL
    case 'date-time':
      return FieldType.DATETIME
    case 'date':
      return FieldType.DATE
    case 'time':
      return FieldType.TIME
  }
  if (sourceType === 'array') return FieldType.TAGS
  if (sourceType === 'number' || sourceType === 'integer') return FieldType.NUMBER
  if (sourceType === 'boolean') return FieldType.CHECKBOX
  const seg = lastSegment(path).toLowerCase()
  if (seg.includes('email')) return FieldType.EMAIL
  if (seg.includes('url') || seg.includes('website')) return FieldType.URL
  if (seg.endsWith('_at') || seg.includes('date')) return FieldType.DATE
  return FieldType.TEXT
}

interface MappingFieldPickerProps {
  /** The def whose fields are the binding targets. Null until a target is picked. */
  entityDefinitionId: string | null
  /** The source node being bound — drives the type filter + quick-create seed. */
  sourceType: string
  sourcePath: string
  /** Detected source string `format` — seeds the quick-create field type (§2.2). */
  sourceFormat?: string
  /** The currently-bound target field ref (`ResourceFieldId`), if any. */
  assignedKey: string | undefined
  /** Resolved label for the bound ref (for the chip), if known. */
  assignedLabel: string | undefined
  /** Target field refs already bound by other entries — hidden (uniqueness). */
  excludeKeys?: Set<string>
  /** Quick-create is wired only for owned defs (plan decision 3). */
  canCreate: boolean
  /** Bind this source node to the chosen target field (canonical `ResourceFieldId`). */
  onAssign: (fieldRef: string) => void
  /** Unbind this source node — surfaced as the in-picker "Don't map" option. */
  onClear: () => void
  /**
   * Flat-FK relationship linking (Approach B). When set, the picker ALSO lists the
   * parent def's existing RELATIONSHIP fields (the inversion of the default
   * exclusion): selecting one links this FK leaf to that relationship. The link is
   * INDEPENDENT of any scalar binding on the same leaf (a leaf can be both) — it's
   * surfaced on its own sub-row, not in this cell. Only relationships whose related
   * def this connector syncs are offered (`syncedDefIds`).
   */
  allowRelationships?: boolean
  /** Entity defs this connector syncs (upsert) — gates which relationships resolve. */
  syncedDefIds?: Set<string>
  /** The currently-linked relationship field's ref, for the in-list selected check. */
  linkedFieldRef?: string
  /** Link this FK leaf to the chosen relationship (desugars to an id-only reference branch). */
  onLinkRelationship?: (field: ResourceField, ref: FieldReference) => void
}

/** A relationship field whose related def is synced — i.e. a valid link target. */
function isLinkableRelationship(field: ResourceField, syncedDefIds?: Set<string>): boolean {
  if (!field.relationship) return false
  if (!syncedDefIds) return true
  const relatedDefId = getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
  return !!relatedDefId && syncedDefIds.has(relatedDefId)
}

/**
 * The leaf-row target control — a single self-managed {@link Popover} whose body
 * swaps between the {@link FieldPickerContent} list and an inline quick-create
 * form (a `view` flip, no stacked popovers). Filters targets by source-type
 * compatibility, and on owned defs offers a quick-create seeded from the source
 * node (friendly name + value-aware type).
 */
export function MappingFieldPicker({
  entityDefinitionId,
  sourceType,
  sourcePath,
  sourceFormat,
  assignedKey,
  assignedLabel,
  excludeKeys,
  canCreate,
  onAssign,
  onClear,
  allowRelationships = false,
  syncedDefIds,
  linkedFieldRef,
  onLinkRelationship,
}: MappingFieldPickerProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'pick' | 'create'>('pick')

  const chipLabel = assignedKey ? (assignedLabel ?? assignedKey) : 'Apply field…'

  // No target def yet — nothing to resolve against. Show a disabled trigger;
  // binding unlocks once a target def is picked (plan 08 §3.4).
  if (!entityDefinitionId) {
    return (
      <Button
        variant='transparent'
        disabled
        className='h-9 w-full justify-between rounded-none px-2 text-xs text-muted-foreground'>
        <span className='truncate'>Pick a target def…</span>
        <ChevronDown className='size-3 opacity-50' />
      </Button>
    )
  }

  // Reset to the list whenever the popover closes, so a re-open never lands on
  // a stale create form.
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setView('pick')
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='transparent'
          className={`h-9 w-full justify-between rounded-none px-2 text-xs hover:bg-primary/5 ${
            assignedKey ? '' : 'text-muted-foreground'
          }`}>
          <span className='truncate'>{chipLabel}</span>
          <ChevronDown className='size-3 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-72 p-0' align='start'>
        {view === 'pick' ? (
          <FieldPickerContent
            entityDefinitionId={entityDefinitionId}
            // Mark the bound scalar AND the linked relationship (independent) with a
            // check — a leaf can carry both.
            fieldReferences={
              [assignedKey, linkedFieldRef].filter((r): r is string => !!r) as ResourceFieldId[]
            }
            // Approach B: list the parent def's RELATIONSHIP fields too (the
            // inversion of the default exclusion) so a flat FK can link to one.
            excludeFields={allowRelationships ? [] : [FieldType.RELATIONSHIP]}
            // A scalar target must be writable + type-compatible + not already bound.
            // A relationship is a link target instead — kept only when its related
            // def is synced by this connector (so the edge can resolve).
            filterField={(f) =>
              f.relationship
                ? allowRelationships && isLinkableRelationship(f, syncedDefIds)
                : !excludeKeys?.has(
                    f.resourceFieldId ?? toResourceFieldId(entityDefinitionId, f.id)
                  ) &&
                  isWritableTarget(f) &&
                  isSourceTargetCompatible(f.fieldType, sourceType)
            }
            // Relationship rows are select-only here (link the FK), never drilled.
            disableDrillDown={allowRelationships}
            mode='single'
            closeOnSelect
            onClose={() => setOpen(false)}
            searchPlaceholder='Search fields…'
            onSelect={(ref, field) => {
              if (field.relationship) {
                onLinkRelationship?.(field, ref)
                return
              }
              onAssign(field.resourceFieldId ?? toResourceFieldId(entityDefinitionId, field.id))
            }}
            // Skip = unbind the SCALAR. Unlinking a relationship lives on the link
            // sub-row, not here. Only offered once a scalar is bound.
            onSkip={assignedKey ? onClear : undefined}
            skipLabel="Don't map this field"
            createLabel='Quick create'
            onCreateField={canCreate ? () => setView('create') : undefined}
          />
        ) : (
          <QuickCreateFieldForm
            entityDefinitionId={entityDefinitionId}
            sourceType={sourceType}
            excludeKeys={excludeKeys}
            seedName={humanizeFieldPath(sourcePath)}
            seedType={inferFieldType(sourcePath, sourceType, sourceFormat)}
            onBack={() => setView('pick')}
            onCreated={(fieldRef) => {
              onAssign(fieldRef)
              onOpenChange(false)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Build the ComboPicker groups for the field-type catalog, minus RELATIONSHIP. */
function useFieldTypeGroups(): OptionGroup[] {
  return useMemo(
    () =>
      Object.entries(FIELD_TYPE_GROUPS)
        .map(([groupName, types]) => ({
          label: groupName,
          options: types
            .filter((type) => type !== FieldType.RELATIONSHIP)
            .map((type) => {
              const opt = fieldTypeOptions[type]
              if (!opt) return null
              return { value: type, label: opt.label, iconId: opt.iconId }
            })
            .filter((o): o is Option => o !== null),
        }))
        .filter((g) => g.options.length > 0),
    []
  )
}

/**
 * Inline name + type quick-create over {@link useCustomFieldMutations} (the same
 * mutation the full field editor uses). A custom field's key equals its name, so
 * the created field binds immediately by its canonical `ResourceFieldId`. The
 * type picker is the full {@link FIELD_TYPE_GROUPS} catalog (minus RELATIONSHIP),
 * pre-seeded from the source node so the common path is two prefilled fields →
 * Create. A pre-flight duplicate-name check steers the user to an existing field
 * instead of a dead-end server error (plan §5.4).
 */
function QuickCreateFieldForm({
  entityDefinitionId,
  sourceType,
  excludeKeys,
  seedName,
  seedType,
  onBack,
  onCreated,
}: {
  entityDefinitionId: string
  sourceType: string
  excludeKeys?: Set<string>
  seedName: string
  seedType: FieldTypeType
  onBack: () => void
  onCreated: (fieldRef: string) => void
}) {
  const [name, setName] = useState(seedName)
  const [type, setType] = useState<FieldTypeType>(seedType)
  const [typePickerOpen, setTypePickerOpen] = useState(false)
  const { create } = useCustomFieldMutations({ entityDefinitionId })

  // Unfiltered field set for the pre-flight name check — the picker list is
  // filtered, so a same-named field may be hidden from it; read it raw here.
  const { fields } = useResourceFields(entityDefinitionId)
  const groups = useFieldTypeGroups()

  const trimmed = name.trim()

  // Existing field whose label collides with the typed name (case-insensitive),
  // and whether it's a usable binding target for this source value.
  const conflict = useMemo(() => {
    if (!trimmed) return null
    const existing = fields.find((f) => f.label.trim().toLowerCase() === trimmed.toLowerCase())
    if (!existing) return null
    const ref = existing.resourceFieldId ?? toResourceFieldId(entityDefinitionId, existing.id)
    const alreadyMapped = excludeKeys?.has(ref) ?? false
    const bindable =
      !alreadyMapped &&
      isWritableTarget(existing) &&
      isSourceTargetCompatible(existing.fieldType, sourceType)
    return { existing, ref, bindable, alreadyMapped }
  }, [trimmed, fields, entityDefinitionId, excludeKeys, sourceType])

  const canSubmit = !!trimmed && !conflict && !create.isPending

  const submit = async () => {
    if (!canSubmit) return
    const field = await create.mutateAsync({ entityDefinitionId, name: trimmed, type })
    onCreated(toResourceFieldId(entityDefinitionId, field.id))
  }

  const selectedTypeOption = fieldTypeOptions[type]
  const selectedAsOption: Option | null = selectedTypeOption
    ? { value: type, label: selectedTypeOption.label, iconId: selectedTypeOption.iconId }
    : null

  return (
    <div className='flex flex-col gap-2 p-3'>
      <button
        type='button'
        onClick={onBack}
        className='-ml-1 flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground'>
        <ChevronLeft className='size-3.5' />
        Quick create
      </button>

      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') onBack()
        }}
        placeholder='Field name'
        className='w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring'
      />

      <ComboPicker
        groups={groups}
        selected={selectedAsOption}
        multi={false}
        className='w-[var(--radix-popover-trigger-width)]!'
        open={typePickerOpen}
        onOpen={() => setTypePickerOpen(true)}
        onClose={() => setTypePickerOpen(false)}
        onChange={(opt) => {
          if (opt && !Array.isArray(opt)) setType(opt.value as FieldTypeType)
          setTypePickerOpen(false)
        }}
        showSearch
        searchPlaceholder='Search field types…'>
        <Button variant='outline' size='sm' className='h-7 w-full justify-between text-xs'>
          <span className='flex items-center gap-2'>
            {selectedTypeOption && (
              <EntityIcon iconId={selectedTypeOption.iconId} variant='default' size='xs' />
            )}
            {selectedTypeOption?.label ?? 'Select type'}
          </span>
          <ChevronsUpDown className='size-3.5 opacity-50' />
        </Button>
      </ComboPicker>

      {conflict?.bindable && (
        <p className='text-xs text-muted-foreground'>
          A field “{conflict.existing.label}” already exists.
        </p>
      )}
      {conflict && !conflict.bindable && (
        <p className='text-xs text-destructive'>
          “{conflict.existing.label}” already exists but{' '}
          {conflict.alreadyMapped ? 'is already mapped' : "isn't compatible with this source value"}
          .
        </p>
      )}

      <div className='flex justify-end gap-1.5'>
        {conflict?.bindable ? (
          <Button variant='outline' size='xs' onClick={() => onCreated(conflict.ref)}>
            Use existing
          </Button>
        ) : (
          <Button
            variant='outline'
            size='xs'
            disabled={!canSubmit}
            loading={create.isPending}
            loadingText='Creating…'
            onClick={() => void submit()}>
            Create
          </Button>
        )}
      </div>
    </div>
  )
}
