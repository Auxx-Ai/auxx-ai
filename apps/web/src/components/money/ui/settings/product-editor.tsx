// apps/web/src/components/money/ui/settings/product-editor.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { RecordId } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useResourceFields } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { type CatalogItem, useCatalogItems } from '../../hooks/use-catalog-items'
import { useSeedCatalogRecord } from '../../hooks/use-seed-catalog-record'
import type { CatalogDraftHandle } from './catalog-draft-types'

interface ProductEditorProps {
  selectedId: string | null
  /** Phantom draft for the Products tab, owned by `products-services-page.tsx`. */
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
 * Right column of the Products & Services tab: a `FieldPanel` form for the
 * selected catalog item. Autosaves per field via `useSaveFieldValue` (same
 * optimistic path as record detail views) — no submit button, no dialog.
 * Renders `ProductDraftEditorForm` instead while `selectedId` is a phantom
 * draft (money 15-settings-phantom-editors.md phase 2).
 */
export function ProductEditor({
  selectedId,
  draft,
  onDraftNameChange,
  onDraftCommitted,
}: ProductEditorProps) {
  const { itemMap, entityDefinitionId, appendRecord } = useCatalogItems()

  // The draft form also stays active while `selectedId` is the draft's
  // committed recordId — swapping to the store-bound form would remount the
  // inputs mid-typing (replaced text + cancelled debounce timer).
  const draftActive =
    !!draft && (selectedId === draft.draftId || (!!draft.recordId && selectedId === draft.recordId))

  if (draft && draftActive) {
    return (
      <ProductDraftEditorForm
        key={draft.draftId}
        entityDefinitionId={entityDefinitionId}
        appendRecord={appendRecord}
        onDraftNameChange={onDraftNameChange}
        onDraftCommitted={onDraftCommitted}
      />
    )
  }

  const item = selectedId ? itemMap.get(selectedId) : undefined

  if (!item) {
    return (
      <div className='p-4 text-sm text-muted-foreground'>Select a product or service to edit.</div>
    )
  }

  return <ProductEditorForm key={item.id} item={item} />
}

function ProductEditorForm({ item }: { item: CatalogItem }) {
  const { fields } = useResourceFields('catalog-items')
  const categoryField = fields.find((f) => f.key === 'category')
  const partField = fields.find((f) => f.key === 'part')

  const { saveFieldValue } = useSaveFieldValue({})

  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description ?? '')

  const commitName = useDebouncedCallback((value: string) => {
    saveFieldValue(item.recordId, 'catalog_item_name', value, FieldType.TEXT)
  }, 500)
  const commitDescription = useDebouncedCallback((value: string) => {
    saveFieldValue(item.recordId, 'catalog_item_description', value || null, FieldType.TEXT)
  }, 500)

  return (
    <div className='p-3'>
      <FieldPanel
        orientation='horizontal'
        breakpoint='md'
        resizeId='catalog-item-form'
        defaultLabelWidth={160}
        className='p-0'>
        <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={name}
            onChange={(value) => {
              setName(value as string)
              commitName(value as string)
            }}
            placeholder='Item name'
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
            placeholder='Enter a description'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Category' type={BaseType.ENUM} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={categoryField?.options}
            value={item.category}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            onChange={(value) =>
              saveFieldValue(item.recordId, 'catalog_item_category', value, FieldType.SINGLE_SELECT)
            }
            placeholder='Select category'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Default Unit Price' type={BaseType.CURRENCY} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.CURRENCY}
            value={item.defaultUnitPriceCents}
            onChange={(value) =>
              saveFieldValue(
                item.recordId,
                'catalog_item_default_unit_price',
                value,
                FieldType.CURRENCY
              )
            }
            placeholder='0.00'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Taxable' type={BaseType.BOOLEAN} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={item.taxable}
            onChange={(value) =>
              saveFieldValue(item.recordId, 'catalog_item_taxable', value, FieldType.CHECKBOX)
            }
          />
        </FieldPanelRow>

        {item.category === 'material' && partField && (
          <FieldPanelRow title='Part' type={BaseType.RELATION} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.RELATIONSHIP}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              fieldOptions={{
                relationship: partField.relationship ?? partField.options?.relationship,
              }}
              value={item.partRecordId ? [item.partRecordId] : []}
              onChange={(value) =>
                saveFieldValue(item.recordId, 'catalog_item_part', value, FieldType.RELATIONSHIP)
              }
              placeholder='Link a part'
            />
          </FieldPanelRow>
        )}
      </FieldPanel>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft (phantom) editor — same layout, local state instead of the store.
// ─────────────────────────────────────────────────────────────────────────────

/** Local, not-yet-persisted field set for a fresh catalog item. Mirrors
 *  `CatalogItem` minus `id`/`recordId` — those only exist once created. */
interface ProductDraftValues {
  name: string
  description: string | null
  category: string
  defaultUnitPriceCents: number | null
  taxable: boolean
  active: boolean
  partRecordId: RecordId | null
}

function freshProductDraftValues(): ProductDraftValues {
  // Category/taxable/active mirror the `catalog_item` registry defaults
  // (packages/lib/src/resources/registry/resources/catalog-item-fields.ts)
  // so the phantom form renders identically to a freshly created row.
  return {
    name: '',
    description: null,
    category: 'service',
    defaultUnitPriceCents: null,
    taxable: true,
    active: true,
    partRecordId: null,
  }
}

/** Draft key → wire descriptor. Drives the create seed, the post-create
 *  diff-flush, and live commit routing once the record exists. */
const PRODUCT_DRAFT_FIELDS: {
  [K in keyof ProductDraftValues]: { fieldId: string; fieldType: FieldType }
} = {
  name: { fieldId: 'catalog_item_name', fieldType: FieldType.TEXT },
  description: { fieldId: 'catalog_item_description', fieldType: FieldType.TEXT },
  category: { fieldId: 'catalog_item_category', fieldType: FieldType.SINGLE_SELECT },
  defaultUnitPriceCents: {
    fieldId: 'catalog_item_default_unit_price',
    fieldType: FieldType.CURRENCY,
  },
  taxable: { fieldId: 'catalog_item_taxable', fieldType: FieldType.CHECKBOX },
  active: { fieldId: 'catalog_item_active', fieldType: FieldType.CHECKBOX },
  partRecordId: { fieldId: 'catalog_item_part', fieldType: FieldType.RELATIONSHIP },
}
const PRODUCT_DRAFT_KEYS = Object.keys(PRODUCT_DRAFT_FIELDS) as (keyof ProductDraftValues)[]

/**
 * Draft-mode `ProductEditorForm`: identical field layout, bound to local
 * state instead of the field-value store. `name` is required server-side
 * (`catalog_item_name`, `capabilities.required: true`) and an empty/whitespace
 * value is treated as absent by `assertRequiredFieldsPresent` — so unlike the
 * line-builder's `line_item_name` (not required), creation here is GATED on
 * `name` being non-empty rather than firing on the very first commit of any
 * field. Edits to other fields while name is still empty just merge into
 * local state (zero network) — this is what keeps the "no placeholder name
 * ever persists" decision true even though the server can't accept a blank
 * name. Once name has a value, whichever commit lands (the name commit
 * itself, or a later one) fires the ONE `record.create` with everything
 * accumulated so far.
 */
function ProductDraftEditorForm({
  entityDefinitionId,
  appendRecord,
  onDraftNameChange,
  onDraftCommitted,
}: {
  entityDefinitionId: string | null
  appendRecord: ReturnType<typeof useCatalogItems>['appendRecord']
  onDraftNameChange: (name: string) => void
  onDraftCommitted: (recordId: string) => void
}) {
  const { fields } = useResourceFields('catalog-items')
  const categoryField = fields.find((f) => f.key === 'category')
  const partField = fields.find((f) => f.key === 'part')

  const { saveMultipleAsync } = useSaveFieldValue({})
  const { seedCatalogRecord } = useSeedCatalogRecord()
  const createRecord = api.record.create.useMutation()

  const valuesRef = useRef<ProductDraftValues>(freshProductDraftValues())
  const [values, setValues] = useState<ProductDraftValues>(valuesRef.current)
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
    async (snapshot: ProductDraftValues) => {
      if (!entityDefinitionId) return
      const createValues: Record<string, unknown> = {
        catalog_item_name: snapshot.name,
        catalog_item_category: snapshot.category,
        catalog_item_taxable: snapshot.taxable,
        catalog_item_active: snapshot.active,
      }
      if (snapshot.description) createValues.catalog_item_description = snapshot.description
      if (snapshot.defaultUnitPriceCents !== null) {
        createValues.catalog_item_default_unit_price = snapshot.defaultUnitPriceCents
      }
      if (snapshot.partRecordId) createValues.catalog_item_part = snapshot.partRecordId

      try {
        const result = await createRecord.mutateAsync({ entityDefinitionId, values: createValues })

        // Flip the commit target FIRST — a keystroke landing while we seed
        // below must route to the real record, not the buffered-create path.
        recordIdRef.current = result.recordId

        seedCatalogRecord({
          entityDefinitionId,
          recordId: result.recordId,
          instance: result.instance,
          values: PRODUCT_DRAFT_KEYS.map((key) => ({
            fieldId: PRODUCT_DRAFT_FIELDS[key].fieldId,
            value: snapshot[key],
            fieldType: PRODUCT_DRAFT_FIELDS[key].fieldType,
          })),
        })

        appendRecord({
          ...result.instance,
          recordId: result.recordId,
          fieldValues: {
            catalog_item_name: snapshot.name,
            catalog_item_description: snapshot.description,
            catalog_item_category: snapshot.category,
            catalog_item_default_unit_price: snapshot.defaultUnitPriceCents,
            catalog_item_taxable: snapshot.taxable,
            catalog_item_active: snapshot.active,
            catalog_item_part: snapshot.partRecordId,
            ...result.values,
          },
        })

        // Diff whatever landed locally while the create was in flight, and
        // flush just the changed fields against the now-real record. (A commit
        // arriving after the recordIdRef flip above may already have saved
        // itself directly — re-flushing the same value here is harmless, the
        // store's per-key mutationVersion guard settles it.)
        const latest = valuesRef.current
        const changed = PRODUCT_DRAFT_KEYS.filter((key) => latest[key] !== snapshot[key]).map(
          (key) => ({
            fieldId: PRODUCT_DRAFT_FIELDS[key].fieldId,
            value: latest[key],
            fieldType: PRODUCT_DRAFT_FIELDS[key].fieldType,
          })
        )
        if (changed.length > 0) await saveMultipleAsync(result.recordId, changed)

        onDraftCommitted(result.instance.id)
      } catch (error) {
        creatingRef.current = false
        toastError({
          title: 'Error creating item',
          description: error instanceof Error ? error.message : 'Could not create the item',
        })
      }
    },
    [
      entityDefinitionId,
      createRecord,
      seedCatalogRecord,
      appendRecord,
      saveMultipleAsync,
      onDraftCommitted,
    ]
  )

  const commitDraft = useCallback(
    (patch: Partial<ProductDraftValues>) => {
      const merged = { ...valuesRef.current, ...patch }
      valuesRef.current = merged
      setValues(merged)

      // Already created (form stayed mounted through the swap): plain
      // optimistic field saves, exactly like the store-bound form.
      const recordId = recordIdRef.current
      if (recordId) {
        const changes = (Object.keys(patch) as (keyof ProductDraftValues)[]).map((key) => ({
          fieldId: PRODUCT_DRAFT_FIELDS[key].fieldId,
          value: merged[key],
          fieldType: PRODUCT_DRAFT_FIELDS[key].fieldType,
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
    <div className='p-3'>
      <FieldPanel
        orientation='horizontal'
        breakpoint='md'
        resizeId='catalog-item-form'
        defaultLabelWidth={160}
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
            placeholder='Item name'
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
            placeholder='Enter a description'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Category' type={BaseType.ENUM} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={categoryField?.options}
            value={values.category}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            onChange={(value) => commitDraft({ category: value as string })}
            placeholder='Select category'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Default Unit Price' type={BaseType.CURRENCY} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.CURRENCY}
            value={values.defaultUnitPriceCents}
            onChange={(value) => commitDraft({ defaultUnitPriceCents: value as number | null })}
            placeholder='0.00'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Taxable' type={BaseType.BOOLEAN} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={values.taxable}
            onChange={(value) => commitDraft({ taxable: value as boolean })}
          />
        </FieldPanelRow>

        {values.category === 'material' && partField && (
          <FieldPanelRow title='Part' type={BaseType.RELATION} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.RELATIONSHIP}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              fieldOptions={{
                relationship: partField.relationship ?? partField.options?.relationship,
              }}
              value={values.partRecordId ? [values.partRecordId] : []}
              onChange={(value) => {
                const ids = value as RecordId[]
                commitDraft({ partRecordId: ids[0] ?? null })
              }}
              placeholder='Link a part'
            />
          </FieldPanelRow>
        )}
      </FieldPanel>
    </div>
  )
}
