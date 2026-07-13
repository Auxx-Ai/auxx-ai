// apps/web/src/components/money/ui/settings/product-editor.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useResourceFields } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { type CatalogItem, useCatalogItems } from '../../hooks/use-catalog-items'

interface ProductEditorProps {
  selectedId: string | null
}

/**
 * Right column of the Products & Services tab: a `FieldPanel` form for the
 * selected catalog item. Autosaves per field via `useSaveFieldValue` (same
 * optimistic path as record detail views) — no submit button, no dialog.
 */
export function ProductEditor({ selectedId }: ProductEditorProps) {
  const { itemMap } = useCatalogItems()
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
