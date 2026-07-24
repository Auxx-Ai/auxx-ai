// apps/web/src/components/money/ui/settings/group-editor.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CircleCheck, CircleDashed, CircleX, GripVertical, Pencil, Plus, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import {
  type CatalogGroupEntry,
  newCatalogGroupEntry,
  serializeCatalogGroupEntries,
} from '~/components/money/catalog-group-types'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSeedCreatedRecord } from '~/components/resources/hooks/use-seed-created-record'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { type CatalogGroup, useCatalogGroups } from '../../hooks/use-catalog-groups'
import { type CatalogItem, useCatalogItems } from '../../hooks/use-catalog-items'
import type { CatalogDraftHandle } from './catalog-draft-types'
import { formatMoney } from './format-money'
import type { TaxRate } from './tax-rate-types'

interface GroupEditorProps {
  selectedId: string | null
  currency: string
  /** Phantom draft for the Product groups tab, owned by `products-services-page.tsx`. */
  draft: CatalogDraftHandle | null
  /** List phantom-row preview sync — fired per debounced name commit. */
  onDraftNameChange: (name: string) => void
  /** First create resolved — swap `selectedId` to the real record id. The page
   *  KEEPS the draft (stamped with `recordId`) so this form stays mounted;
   *  see `CatalogDraftHandle.recordId` for why a remount here loses text. */
  onDraftCommitted: (recordId: string) => void
}

/** `FocusableInputWrapper` (field-input-adapter.tsx) autofocuses once `open` is
 *  truthy — a stable no-op keeps the effect from refiring every render. */
function noop() {}

/**
 * Right column of the Product groups tab: a `FieldPanel` form for the
 * selected group (name/description/tax rate/discount/active, autosaved via
 * `useSaveFieldValue`), plus an entries section below (drag-reorder,
 * qty/description/taxable overrides). Renders `GroupDraftEditorForm` instead
 * while `selectedId` is a phantom draft (money 15-settings-phantom-editors.md
 * phase 2).
 */
export function GroupEditor({
  selectedId,
  currency,
  draft,
  onDraftNameChange,
  onDraftCommitted,
}: GroupEditorProps) {
  const { groupMap } = useCatalogGroups()

  // The draft form also stays active while `selectedId` is the draft's
  // committed recordId — swapping to the store-bound form would remount the
  // inputs mid-typing (replaced text + cancelled debounce timer).
  const draftActive =
    !!draft && (selectedId === draft.draftId || (!!draft.recordId && selectedId === draft.recordId))

  if (draft && draftActive) {
    return (
      <GroupDraftEditorForm
        key={draft.draftId}
        currency={currency}
        onDraftNameChange={onDraftNameChange}
        onDraftCommitted={onDraftCommitted}
      />
    )
  }

  const group = selectedId ? groupMap.get(selectedId) : undefined

  if (!group) {
    return <div className='p-4 text-sm text-muted-foreground'>Select a product group to edit.</div>
  }

  return <GroupEditorForm key={group.id} group={group} currency={currency} />
}

function GroupEditorForm({ group, currency }: { group: CatalogGroup; currency: string }) {
  const { itemMap, items } = useCatalogItems()
  const { getSetting } = useSettings({ scope: 'DOCUMENTS' })
  const taxRates = (getSetting('documents.taxRates') as TaxRate[] | null) ?? []
  const taxOptions = useMemo(
    () => taxRates.map((rate) => ({ label: `${rate.name} (${rate.rate}%)`, value: rate.id })),
    [taxRates]
  )

  const { saveFieldValue, saveMultipleAsync } = useSaveFieldValue({})

  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description ?? '')

  const commitName = useDebouncedCallback((value: string) => {
    saveFieldValue(group.recordId, 'catalog_group_name', value, FieldType.TEXT)
  }, 500)
  const commitDescription = useDebouncedCallback((value: string) => {
    saveFieldValue(group.recordId, 'catalog_group_description', value || null, FieldType.TEXT)
  }, 500)

  // Envelope, not a bare array — the generic save path splits top-level arrays
  // into one row per element (see serializeCatalogGroupEntries).
  function commitEntries(next: CatalogGroupEntry[]) {
    saveFieldValue(
      group.recordId,
      'catalog_group_entries',
      serializeCatalogGroupEntries(next),
      FieldType.JSON
    )
  }

  const writeDiscount = (type: 'percent' | 'amount' | null, value: number | null) => {
    void saveMultipleAsync(group.recordId, [
      { fieldId: 'catalog_group_discount_type', value: type, fieldType: FieldType.SINGLE_SELECT },
      { fieldId: 'catalog_group_discount_value', value, fieldType: FieldType.NUMBER },
    ])
  }

  return (
    <div className='flex flex-col gap-3 p-3'>
      <FieldPanel
        orientation='horizontal'
        breakpoint='md'
        resizeId='catalog-group-form'
        defaultLabelWidth={140}
        className='p-0'>
        <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={name}
            onChange={(value) => {
              setName(value as string)
              commitName(value as string)
            }}
            placeholder='Group name'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Description' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            fieldOptions={{ multiline: true }}
            value={description}
            onChange={(value) => {
              setDescription(value as string)
              commitDescription(value as string)
            }}
            placeholder='Admin-facing note'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Tax rate' type={BaseType.ENUM} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: taxOptions }}
            value={group.taxRateId ? [group.taxRateId] : []}
            triggerProps={{ showClear: true, className: 'w-full' }}
            onChange={(value) =>
              saveFieldValue(
                group.recordId,
                'catalog_group_tax_rate_id',
                (value as string[])[0] ?? null,
                FieldType.TEXT
              )
            }
            placeholder='No tax'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Discount' type={BaseType.NUMBER} showIcon>
          <DiscountEditor
            discountType={group.discountType}
            discountValue={group.discountValue}
            onChange={writeDiscount}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Active' type={BaseType.BOOLEAN} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={group.active}
            onChange={(value) =>
              saveFieldValue(group.recordId, 'catalog_group_active', value, FieldType.CHECKBOX)
            }
          />
        </FieldPanelRow>
      </FieldPanel>

      <EntriesSection
        entries={group.entries}
        itemMap={itemMap}
        items={items}
        currency={currency}
        onChange={commitEntries}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft (phantom) editor — same layout, local state instead of the store.
// ─────────────────────────────────────────────────────────────────────────────

/** Local, not-yet-persisted field set for a fresh catalog group. Mirrors
 *  `CatalogGroup` minus `id`/`recordId` — those only exist once created. */
interface GroupDraftValues {
  name: string
  description: string | null
  entries: CatalogGroupEntry[]
  taxRateId: string | null
  discountType: 'percent' | 'amount' | null
  discountValue: number | null
  active: boolean
}

function freshGroupDraftValues(): GroupDraftValues {
  // `active` mirrors the `catalog_group` registry default
  // (packages/lib/src/resources/registry/resources/catalog-group-fields.ts).
  return {
    name: '',
    description: null,
    entries: [],
    taxRateId: null,
    discountType: null,
    discountValue: null,
    active: true,
  }
}

/** Draft key → wire descriptor. Drives the create seed, the post-create
 *  diff-flush, and live commit routing once the record exists. */
const GROUP_DRAFT_FIELDS: {
  [K in keyof GroupDraftValues]: { fieldId: string; fieldType: FieldType }
} = {
  name: { fieldId: 'catalog_group_name', fieldType: FieldType.TEXT },
  description: { fieldId: 'catalog_group_description', fieldType: FieldType.TEXT },
  entries: { fieldId: 'catalog_group_entries', fieldType: FieldType.JSON },
  taxRateId: { fieldId: 'catalog_group_tax_rate_id', fieldType: FieldType.TEXT },
  discountType: { fieldId: 'catalog_group_discount_type', fieldType: FieldType.SINGLE_SELECT },
  discountValue: { fieldId: 'catalog_group_discount_value', fieldType: FieldType.NUMBER },
  active: { fieldId: 'catalog_group_active', fieldType: FieldType.CHECKBOX },
}
const GROUP_DRAFT_KEYS = Object.keys(GROUP_DRAFT_FIELDS) as (keyof GroupDraftValues)[]

/** Entries go over the wire in the `{ entries: [...] }` envelope (the generic
 *  save path splits bare top-level arrays into one row per element). */
function groupWireValue(key: keyof GroupDraftValues, values: GroupDraftValues): unknown {
  return key === 'entries' ? serializeCatalogGroupEntries(values.entries) : values[key]
}

/**
 * Draft-mode `GroupEditorForm`: identical field layout (+ entries section),
 * bound to local state instead of the field-value store. `name` is required
 * server-side (`catalog_group_name`) and empty/whitespace is treated as
 * absent by `assertRequiredFieldsPresent` — so, like `ProductDraftEditorForm`,
 * creation is GATED on `name` being non-empty rather than firing on the very
 * first commit of any field (entries/discount/tax-rate edits made before a
 * name exists just merge into local state, zero network — this is what keeps
 * the "no placeholder name ever persists" decision true).
 */
function GroupDraftEditorForm({
  currency,
  onDraftNameChange,
  onDraftCommitted,
}: {
  currency: string
  onDraftNameChange: (name: string) => void
  onDraftCommitted: (recordId: string) => void
}) {
  const { itemMap, items } = useCatalogItems()
  const { entityDefinitionId, appendRecord } = useCatalogGroups()
  const { getSetting } = useSettings({ scope: 'DOCUMENTS' })
  const taxRates = (getSetting('documents.taxRates') as TaxRate[] | null) ?? []
  const taxOptions = useMemo(
    () => taxRates.map((rate) => ({ label: `${rate.name} (${rate.rate}%)`, value: rate.id })),
    [taxRates]
  )

  const { saveMultipleAsync } = useSaveFieldValue({})
  const { seedCreatedRecord } = useSeedCreatedRecord()
  const createRecord = api.record.create.useMutation()

  const valuesRef = useRef<GroupDraftValues>(freshGroupDraftValues())
  const [values, setValues] = useState<GroupDraftValues>(valuesRef.current)
  // Synchronous guard (not state-derived) so two commits landing before a
  // re-render can never race two `record.create` calls for the same draft.
  const creatingRef = useRef(false)
  // Set once the create resolves. This form stays mounted afterwards (the
  // page keeps the draft alive, see onDraftCommitted) and every later commit
  // routes straight through saveMultipleAsync against this id — so text typed
  // during and after the create round trip is never replaced by a remount.
  const recordIdRef = useRef<RecordId | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const createNow = useCallback(
    async (snapshot: GroupDraftValues) => {
      if (!entityDefinitionId) return
      const createValues: Record<string, unknown> = {
        catalog_group_name: snapshot.name,
        catalog_group_active: snapshot.active,
        catalog_group_entries: serializeCatalogGroupEntries(snapshot.entries),
      }
      if (snapshot.description) createValues.catalog_group_description = snapshot.description
      if (snapshot.taxRateId) createValues.catalog_group_tax_rate_id = snapshot.taxRateId
      if (snapshot.discountType) {
        createValues.catalog_group_discount_type = snapshot.discountType
        createValues.catalog_group_discount_value = snapshot.discountValue
      }

      try {
        const result = await createRecord.mutateAsync({ entityDefinitionId, values: createValues })

        // Flip the commit target FIRST — a keystroke landing while we seed
        // below must route to the real record, not the buffered-create path.
        recordIdRef.current = result.recordId

        seedCreatedRecord({
          entityDefinitionId,
          recordId: result.recordId,
          instance: result.instance,
          values: GROUP_DRAFT_KEYS.map((key) => ({
            fieldId: GROUP_DRAFT_FIELDS[key].fieldId,
            value: groupWireValue(key, snapshot),
            fieldType: GROUP_DRAFT_FIELDS[key].fieldType,
          })),
        })

        appendRecord({
          ...result.instance,
          recordId: result.recordId,
          fieldValues: {
            catalog_group_name: snapshot.name,
            catalog_group_description: snapshot.description,
            catalog_group_entries: serializeCatalogGroupEntries(snapshot.entries),
            catalog_group_tax_rate_id: snapshot.taxRateId,
            catalog_group_discount_type: snapshot.discountType,
            catalog_group_discount_value: snapshot.discountValue,
            catalog_group_active: snapshot.active,
            ...result.values,
          },
        })

        // Diff whatever landed locally while the create was in flight, and
        // flush just the changed fields against the now-real record. (A commit
        // arriving after the recordIdRef flip above may already have saved
        // itself directly — re-flushing the same value here is harmless, the
        // store's per-key mutationVersion guard settles it.)
        const latest = valuesRef.current
        const changed = GROUP_DRAFT_KEYS.filter((key) => latest[key] !== snapshot[key]).map(
          (key) => ({
            fieldId: GROUP_DRAFT_FIELDS[key].fieldId,
            value: groupWireValue(key, latest),
            fieldType: GROUP_DRAFT_FIELDS[key].fieldType,
          })
        )
        if (changed.length > 0) await saveMultipleAsync(result.recordId, changed)

        onDraftCommitted(result.instance.id)
      } catch (error) {
        creatingRef.current = false
        toastError({
          title: 'Error creating group',
          description: error instanceof Error ? error.message : 'Could not create the group',
        })
      }
    },
    [
      entityDefinitionId,
      createRecord,
      seedCreatedRecord,
      appendRecord,
      saveMultipleAsync,
      onDraftCommitted,
    ]
  )

  const commitDraft = useCallback(
    (patch: Partial<GroupDraftValues>) => {
      const merged = { ...valuesRef.current, ...patch }
      valuesRef.current = merged
      setValues(merged)

      // Already created (form stayed mounted through the swap): plain
      // optimistic field saves, exactly like the store-bound form.
      const recordId = recordIdRef.current
      if (recordId) {
        const changes = (Object.keys(patch) as (keyof GroupDraftValues)[]).map((key) => ({
          fieldId: GROUP_DRAFT_FIELDS[key].fieldId,
          value: groupWireValue(key, merged),
          fieldType: GROUP_DRAFT_FIELDS[key].fieldType,
        }))
        if (changes.length > 0) void saveMultipleAsync(recordId, changes)
        return
      }

      if (patch.name !== undefined) onDraftNameChange(patch.name)
      if (creatingRef.current) return // create in-flight — merged above, diff-flush picks it up
      if (!merged.name.trim() || !entityDefinitionId) return // buffering: name required to create

      creatingRef.current = true
      void createNow(merged)
    },
    [createNow, entityDefinitionId, onDraftNameChange, saveMultipleAsync]
  )

  const commitName = useDebouncedCallback((value: string) => {
    commitDraft({ name: value })
  }, 500)
  const commitDescription = useDebouncedCallback((value: string) => {
    commitDraft({ description: value || null })
  }, 500)

  return (
    <div className='flex flex-col gap-3 p-3'>
      <FieldPanel
        orientation='horizontal'
        breakpoint='md'
        resizeId='catalog-group-form'
        defaultLabelWidth={140}
        className='p-0'>
        <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={name}
            open
            onOpenChange={noop}
            onChange={(value) => {
              setName(value as string)
              commitName(value as string)
            }}
            placeholder='Group name'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Description' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            fieldOptions={{ multiline: true }}
            value={description}
            onChange={(value) => {
              setDescription(value as string)
              commitDescription(value as string)
            }}
            placeholder='Admin-facing note'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Tax rate' type={BaseType.ENUM} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: taxOptions }}
            value={values.taxRateId ? [values.taxRateId] : []}
            triggerProps={{ showClear: true, className: 'w-full' }}
            onChange={(value) => commitDraft({ taxRateId: (value as string[])[0] ?? null })}
            placeholder='No tax'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Discount' type={BaseType.NUMBER} showIcon>
          <DiscountEditor
            discountType={values.discountType}
            discountValue={values.discountValue}
            onChange={(type, value) => commitDraft({ discountType: type, discountValue: value })}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Active' type={BaseType.BOOLEAN} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={values.active}
            onChange={(value) => commitDraft({ active: value as boolean })}
          />
        </FieldPanelRow>
      </FieldPanel>

      <EntriesSection
        entries={values.entries}
        itemMap={itemMap}
        items={items}
        currency={currency}
        onChange={(next) => commitDraft({ entries: next })}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Discount widget — type toggle (%/$) + amount input, shared by the real and
// draft forms (only the commit target differs).
// ─────────────────────────────────────────────────────────────────────────────

function DiscountEditor({
  discountType,
  discountValue,
  onChange,
}: {
  discountType: 'percent' | 'amount' | null
  discountValue: number | null
  onChange: (type: 'percent' | 'amount' | null, value: number | null) => void
}) {
  const [discountDraft, setDiscountDraft] = useState<string | null>(null)

  // Amount discounts are stored as integer cents (CURRENCY convention); percent
  // discounts as plain percentages — the input always shows/accepts the display
  // unit. Mirrors the totals-footer.tsx conversion idiom.
  const discountDisplayValue =
    discountValue === null
      ? ''
      : String(discountType === 'amount' ? discountValue / 100 : discountValue)

  const commitDiscountValue = () => {
    if (discountDraft === null) return
    const trimmed = discountDraft.trim()
    setDiscountDraft(null)
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed !== null && Number.isNaN(parsed)) return
    const type = parsed === null ? null : (discountType ?? 'percent')
    onChange(type, parsed !== null && type === 'amount' ? Math.round(parsed * 100) : parsed)
  }

  // Type toggle keeps the number the user SEES stable: 10% becomes $10 (1000¢).
  const toggleDiscountType = (type: 'percent' | 'amount') => {
    if (discountValue === null) {
      onChange(type, null)
      return
    }
    const displayed = discountType === 'amount' ? discountValue / 100 : discountValue
    onChange(type, type === 'amount' ? Math.round(displayed * 100) : displayed)
  }

  return (
    <div className='flex items-center gap-1.5'>
      <div className='flex overflow-hidden rounded-md border border-primary-200/60 dark:border-[#2c313a]'>
        {(['percent', 'amount'] as const).map((type) => (
          <button
            key={type}
            type='button'
            onClick={() => toggleDiscountType(type)}
            className={cn(
              'px-2 py-1 text-xs leading-none',
              (discountType ?? 'percent') === type
                ? 'bg-primary-150 text-foreground dark:bg-primary-100'
                : 'text-muted-foreground hover:bg-primary-100/60'
            )}>
            {type === 'percent' ? '%' : '$'}
          </button>
        ))}
      </div>
      <input
        value={discountDraft ?? discountDisplayValue}
        onChange={(e) => setDiscountDraft(e.target.value)}
        onBlur={commitDiscountValue}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setDiscountDraft(null)
        }}
        inputMode='decimal'
        placeholder='0'
        className='w-20 rounded-md border border-primary-200/60 bg-transparent px-2 py-1 text-sm tabular-nums outline-none hover:bg-primary-100/60 focus:bg-primary-100/80 dark:border-[#2c313a]'
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Entries section — drag-reorder list + "Add item" popover
// ─────────────────────────────────────────────────────────────────────────────

function EntriesSection({
  entries,
  itemMap,
  items,
  currency,
  onChange,
}: {
  entries: CatalogGroupEntry[]
  itemMap: Map<string, CatalogItem>
  items: CatalogItem[]
  currency: string
  onChange: (next: CatalogGroupEntry[]) => void
}) {
  const [addOpen, setAddOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = entries.findIndex((e) => e.id === active.id)
    const newIndex = entries.findIndex((e) => e.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onChange(arrayMove(entries, oldIndex, newIndex))
  }

  function handleAddItem(catalogItemId: string) {
    onChange([...entries, newCatalogGroupEntry(catalogItemId)])
    setAddOpen(false)
  }

  function handleRemove(entryId: string) {
    onChange(entries.filter((e) => e.id !== entryId))
  }

  function handlePatch(entryId: string, patch: Partial<CatalogGroupEntry>) {
    onChange(entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)))
  }

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between px-1'>
        <span className='font-medium text-muted-foreground text-xs'>Items</span>
        <AddItemPopover
          open={addOpen}
          onOpenChange={setAddOpen}
          items={items}
          currency={currency}
          onPick={handleAddItem}
        />
      </div>

      {entries.length === 0 ? (
        <div className='rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground'>
          No items yet — add one to build this group.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}>
          <SortableContext items={entries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
            <div className='flex flex-col gap-0.5'>
              {entries.map((entry) => (
                <GroupEntryRow
                  key={entry.id}
                  entry={entry}
                  item={itemMap.get(entry.catalogItemId)}
                  currency={currency}
                  onPatch={(patch) => handlePatch(entry.id, patch)}
                  onRemove={() => handleRemove(entry.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

function GroupEntryRow({
  entry,
  item,
  currency,
  onPatch,
  onRemove,
}: {
  entry: CatalogGroupEntry
  item: CatalogItem | undefined
  currency: string
  onPatch: (patch: Partial<CatalogGroupEntry>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  })
  const [expanded, setExpanded] = useState(false)
  const [qtyDraft, setQtyDraft] = useState<string | null>(null)
  const [descDraft, setDescDraft] = useState<string | null>(null)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
  }

  const dragHandle = (
    <span {...attributes} {...listeners} className='cursor-grab touch-none'>
      <GripVertical className='size-4' />
    </span>
  )

  const commitQty = () => {
    if (qtyDraft === null) return
    const trimmed = qtyDraft.trim()
    setQtyDraft(null)
    const parsed = Number(trimmed)
    if (!trimmed || Number.isNaN(parsed) || parsed <= 0) return
    onPatch({ qty: parsed })
  }

  const commitDescription = () => {
    if (descDraft === null) return
    onPatch({ description: descDraft.trim() || null })
    setDescDraft(null)
  }

  // Tri-state cycle: inherit (absent) → taxable → not taxable → inherit.
  function cycleTaxable() {
    if (entry.taxable === undefined) onPatch({ taxable: true })
    else if (entry.taxable === true) onPatch({ taxable: false })
    else onPatch({ taxable: undefined })
  }

  // Dangling entry — the referenced catalog item no longer resolves. Deleting a
  // product doesn't rewrite groups; this row is where staleness surfaces.
  if (!item) {
    return (
      <div ref={setNodeRef} style={style}>
        <TreeRow
          icon={dragHandle}
          title={<span className='text-destructive text-sm'>Deleted item</span>}
          rowClassName='bg-destructive/5 hover:bg-destructive/10'
          secondary={<span className='text-destructive/70 text-xs'>Qty {entry.qty}</span>}
          actions={
            <TreeRowButton tooltipText='Remove' variant='destructive' onClick={onRemove}>
              <X />
            </TreeRowButton>
          }
        />
      </div>
    )
  }

  const subtotal =
    item.defaultUnitPriceCents === null ? null : item.defaultUnitPriceCents * entry.qty
  const TaxableIcon =
    entry.taxable === undefined ? CircleDashed : entry.taxable ? CircleCheck : CircleX
  const taxableLabel =
    entry.taxable === undefined
      ? `Inherit (${item.taxable ? 'taxable' : 'not taxable'})`
      : entry.taxable
        ? 'Taxable'
        : 'Not taxable'

  return (
    <div ref={setNodeRef} style={style} className='flex flex-col'>
      <TreeRow
        icon={dragHandle}
        title={<span className={cn('text-sm', !item.active && 'opacity-60')}>{item.name}</span>}
        rowClassName='bg-primary-50 hover:bg-primary-100'
        secondary={
          <span className='truncate text-muted-foreground text-xs'>
            {formatMoney(item.defaultUnitPriceCents, currency)} × {entry.qty}
            {subtotal !== null && ` = ${formatMoney(subtotal, currency)}`}
          </span>
        }
        actions={
          <div className='flex items-center gap-1'>
            <input
              value={qtyDraft ?? String(entry.qty)}
              onChange={(e) => setQtyDraft(e.target.value)}
              onBlur={commitQty}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setQtyDraft(null)
              }}
              inputMode='decimal'
              className='w-10 rounded-sm border-none bg-transparent px-1 text-right text-xs tabular-nums outline-none hover:bg-primary-100/60 focus:bg-primary-100/80'
            />
            <TreeRowButton
              tooltipText='Description override'
              onClick={() => setExpanded((v) => !v)}>
              <Pencil />
            </TreeRowButton>
            <TreeRowButton tooltipText={taxableLabel} onClick={cycleTaxable}>
              <TaxableIcon />
            </TreeRowButton>
            <TreeRowButton tooltipText='Remove' variant='destructive' onClick={onRemove}>
              <X />
            </TreeRowButton>
          </div>
        }
      />
      {expanded && (
        <div className='pb-1.5 pl-9 pr-1'>
          <input
            value={descDraft ?? entry.description ?? ''}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDescription}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setDescDraft(null)
            }}
            placeholder={item.description || 'Description override'}
            className='w-full rounded-md border border-primary-200/60 bg-transparent px-2 py-1 text-xs outline-none dark:border-[#2c313a]'
          />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// "Add item" popover — a slim local copy of catalog-picker.tsx's grouped
// Command list, over ACTIVE catalog items only (catalog-picker itself is
// line-oriented and doesn't fit this shape).
// ─────────────────────────────────────────────────────────────────────────────

function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value
}

function AddItemPopover({
  open,
  onOpenChange,
  items,
  currency,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: CatalogItem[]
  currency: string
  onPick: (catalogItemId: string) => void
}) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const active = items.filter((item) => item.active)
    const filtered = q ? active.filter((item) => item.name.toLowerCase().includes(q)) : active

    const byCategory = new Map<string, CatalogItem[]>()
    for (const item of filtered) {
      const bucket = byCategory.get(item.category) ?? []
      bucket.push(item)
      byCategory.set(item.category, bucket)
    }

    return [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, rows]) => ({
        category,
        rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [items, query])

  const hasAnyMatch = groups.some((g) => g.rows.length > 0)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (next) setQuery('')
      }}>
      <PopoverTrigger asChild>
        <Button variant='outline' size='xs'>
          <Plus />
          Add item
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-[280px] p-0'>
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder='Search products & services…'
          />
          <CommandList>
            {!hasAnyMatch && <CommandEmpty>No active items</CommandEmpty>}
            {groups.map(
              (group) =>
                group.rows.length > 0 && (
                  <CommandGroup key={group.category} heading={titleCase(group.category)}>
                    {group.rows.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        onSelect={() => onPick(item.id)}
                        className='flex items-center justify-between gap-2'>
                        <span className='truncate'>{item.name}</span>
                        <span className='shrink-0 text-muted-foreground text-xs'>
                          {formatMoney(item.defaultUnitPriceCents, currency)}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
