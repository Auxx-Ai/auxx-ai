// apps/web/src/components/data-connectors/ui/mapping-field-picker.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeType } from '@auxx/database/types'
import { FIELD_TYPE_GROUPS, fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import type { ResourceField } from '@auxx/lib/resources/client'
import {
  type FieldPath,
  type FieldReference,
  getFieldDefinitionId,
  isFieldPath,
  toResourceFieldId,
} from '@auxx/types/field'
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
import { inferFieldType } from '../lib/source-path-fields'
import { isSourceTargetCompatible, isWritableTarget } from './field-type-compat'

interface MappingFieldPickerProps {
  /**
   * Whether this picker binds a scalar leaf ('leaf') or fans out a related record
   * from an object/array branch ('branch'). Both drill the same relationship graph;
   * 'branch' only ever selects a relationship (the fan-out target).
   */
  kind?: 'leaf' | 'branch'
  /** The def the picker drills/binds FROM (the enclosing mapping's def). Null = no def yet. */
  entityDefinitionId: string | null
  /** The source node being bound — drives the type filter + quick-create seed ('leaf'). */
  sourceType?: string
  /**
   * The source leaf's DECLARED struct field type (`ADDRESS_STRUCT`), when it carries one.
   * Constrains the target filter to that type's accepting sinks and seeds quick-create to
   * it — bypassing the lossy `object → JSON` reduction the bare `sourceType` would apply.
   */
  sourceFieldType?: FieldTypeType
  sourcePath?: string
  /** Detected source string `format` — seeds the quick-create field type (§2.2). */
  sourceFormat?: string
  /** The currently-bound DIRECT target field ref (`ResourceFieldId`), if any. */
  assignedKey?: string | undefined
  /** Resolved label for the bound ref/path (for the chip), if known. */
  assignedLabel?: string | undefined
  /**
   * Resolved icon id for the applied field — mirrors the field icon the picker list
   * shows ({@link FieldItem}), so the trigger chip matches the row you picked.
   */
  assignedIconId?: string | undefined
  /**
   * Set when this leaf is bound ACROSS a relationship (a drilled `FieldPath`, e.g.
   * `order:email → ["order:contact","contact:email"]`). Drives the in-list selected
   * check on the far field; the chip shows {@link assignedLabel}.
   */
  drilledRef?: FieldReference
  /** Target field refs already bound by other entries on the ROOT def — hidden (uniqueness). */
  excludeKeys?: Set<string>
  /** Quick-create is wired only for owned defs (plan decision 3). */
  canCreate?: boolean
  /**
   * The enclosing mapping is OWNED — the owned-mode sink writes via its bypass crud
   * handler, so the def's connector-managed (user-read-only) columns are valid
   * targets. Relaxes {@link isWritableTarget} for those fields.
   */
  ownedWrite?: boolean
  /** Trigger placeholder when nothing is assigned (default "Apply field…"). */
  placeholder?: string
  /** Bind this source node to a DIRECT field on the current def (canonical `ResourceFieldId`). */
  onAssign?: (fieldRef: string) => void
  /** Bind this source node ACROSS a relationship — a drilled `FieldPath` (§2 unified model). */
  onDrilledAssign?: (field: ResourceField, ref: FieldPath) => void
  /** Unbind this source node — surfaced as the in-picker "Don't map" option. */
  onClear?: () => void
  /**
   * Whether RELATIONSHIP fields are shown (and so drillable). Off for formula rows
   * and array leaves. Always on for a 'branch'.
   */
  allowRelationships?: boolean
  /** The currently-linked relationship field's ref, for the in-list selected check. */
  linkedFieldRef?: string
  /**
   * A relationship was selected (not drilled past). 'leaf' → id-only link the FK to it;
   * 'branch' → fan the branch out into a related child record. The handler decides which.
   */
  onSelectRelationship?: (field: ResourceField, ref: FieldReference) => void
}

/**
 * The unified target control (relationship-linking v3 — unified picker). One
 * self-managed {@link Popover} that drills the relationship graph from
 * {@link entityDefinitionId}: select a scalar at root → bind it directly; drill a
 * relationship and select a scalar → bind ACROSS the relationship (a `FieldPath`);
 * select a relationship itself → link/fan-out a related record. The same control
 * renders on leaf rows AND branch rows so nothing reads as a different cell.
 */
export function MappingFieldPicker({
  kind = 'leaf',
  entityDefinitionId,
  sourceType = 'string',
  sourceFieldType,
  sourcePath = '',
  sourceFormat,
  assignedKey,
  assignedLabel,
  assignedIconId,
  drilledRef,
  excludeKeys,
  canCreate = false,
  ownedWrite = false,
  placeholder,
  onAssign,
  onDrilledAssign,
  onClear,
  allowRelationships = false,
  linkedFieldRef,
  onSelectRelationship,
}: MappingFieldPickerProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'pick' | 'create'>('pick')

  const isBranch = kind === 'branch'
  const showRelationships = isBranch || allowRelationships
  // A VALUE binding (direct scalar or drilled-across) vs a link-only leaf (an id-only
  // relationship whose FK anchors an edge but writes no column). Both make the trigger
  // read "active"; only a value binding drives the icon + the in-picker "Don't map".
  const isAssigned = !!assignedKey || !!drilledRef
  const isLinked = !!linkedFieldRef
  const isActive = isAssigned || isLinked
  // Chip prefers a value/drill label, then the bound key, then a bare "Linked" for a
  // link-only leaf (the relationship renders its own sub-row), else the placeholder.
  const chipLabel =
    assignedLabel ?? assignedKey ?? (isLinked ? 'Linked' : (placeholder ?? 'Apply field…'))

  // No target def yet — show a disabled trigger; binding unlocks once a target def is
  // picked (plan 08 §3.4).
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
          className={`h-9 w-full justify-between rounded-none px-2 text-xs hover:bg-primary-200/20 ${
            isActive ? '' : 'text-primary-400'
          }`}>
          <span className='flex min-w-0 items-center gap-1.5'>
            {isAssigned && assignedIconId && (
              <EntityIcon
                iconId={assignedIconId}
                size='sm'
                className='inset-shadow-xs inset-shadow-black/20 shrink-0 bg-primary-300'
              />
            )}
            <span className='truncate'>{chipLabel}</span>
          </span>
          <ChevronDown className='size-3 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-72 p-0' align='start'>
        {view === 'pick' ? (
          <FieldPickerContent
            entityDefinitionId={entityDefinitionId}
            // Check the bound DIRECT scalar, the drilled FieldPath, and any id-only
            // link — a leaf can carry both a value bind and a link.
            fieldReferences={
              [assignedKey, linkedFieldRef, drilledRef].filter(
                (r): r is FieldReference => !!r
              ) as FieldReference[]
            }
            // Show relationships (so they're drillable) for leaves that allow them and
            // for every branch; otherwise hide them (formula rows / array leaves).
            excludeFields={showRelationships ? [] : [FieldType.RELATIONSHIP]}
            // Relationships are always shown (drillable). A scalar target must be
            // writable + type-compatible; the no-double-bind exclusion only applies to
            // the ROOT def (a drilled-into related def has its own keyspace). A branch
            // binds no scalar — only its relationships are selectable.
            filterField={(f) => {
              if (f.relationship) return showRelationships
              if (isBranch) return false
              const rfid = f.resourceFieldId ?? toResourceFieldId(entityDefinitionId, f.id)
              const notExcluded =
                getFieldDefinitionId(rfid) === entityDefinitionId ? !excludeKeys?.has(rfid) : true
              return (
                notExcluded &&
                isWritableTarget(f, { ownedWrite }) &&
                isSourceTargetCompatible(f.fieldType, sourceType, sourceFieldType)
              )
            }}
            mode='single'
            closeOnSelect
            onClose={() => setOpen(false)}
            searchPlaceholder={isBranch ? 'Search relationships…' : 'Search fields…'}
            onSelect={(ref, field) => {
              // Relationship picked → link (leaf) / fan out (branch).
              if (field.relationship) {
                onSelectRelationship?.(field, ref)
                return
              }
              // Scalar reached by drilling → bind across the relationship.
              if (isFieldPath(ref)) {
                onDrilledAssign?.(field, ref)
                return
              }
              // Scalar at root → bind directly on the current def.
              onAssign?.(field.resourceFieldId ?? toResourceFieldId(entityDefinitionId, field.id))
            }}
            // Skip = unbind whatever is currently bound on this leaf (direct or drilled).
            onSkip={!isBranch && isAssigned ? onClear : undefined}
            skipLabel="Don't map this field"
            createLabel='Quick create'
            onCreateField={!isBranch && canCreate ? () => setView('create') : undefined}
          />
        ) : (
          <QuickCreateFieldForm
            entityDefinitionId={entityDefinitionId}
            sourceType={sourceType}
            sourceFieldType={sourceFieldType}
            ownedWrite={ownedWrite}
            excludeKeys={excludeKeys}
            seedName={humanizeFieldPath(sourcePath)}
            seedType={sourceFieldType ?? inferFieldType(sourcePath, sourceType, sourceFormat)}
            onBack={() => setView('pick')}
            onCreated={(fieldRef) => {
              // Optional like the pick path above — quick-create is only reachable via
              // `canCreate`, which no caller sets without also passing `onAssign`.
              onAssign?.(fieldRef)
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
          options: types.flatMap<Option>((type) => {
            if (type === FieldType.RELATIONSHIP) return []
            const opt = fieldTypeOptions[type]
            return opt ? [{ value: type, label: opt.label, iconId: opt.iconId }] : []
          }),
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
  sourceFieldType,
  ownedWrite,
  excludeKeys,
  seedName,
  seedType,
  onBack,
  onCreated,
}: {
  entityDefinitionId: string
  sourceType: string
  sourceFieldType?: FieldTypeType
  ownedWrite?: boolean
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
      isWritableTarget(existing, { ownedWrite }) &&
      isSourceTargetCompatible(existing.fieldType, sourceType, sourceFieldType)
    return { existing, ref, bindable, alreadyMapped }
  }, [trimmed, fields, entityDefinitionId, excludeKeys, sourceType, sourceFieldType, ownedWrite])

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
