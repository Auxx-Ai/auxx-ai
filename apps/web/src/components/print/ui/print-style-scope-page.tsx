// apps/web/src/components/print/ui/print-style-scope-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { ExportType, PrintStyle } from '@auxx/lib/export/client'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { FileStack, FileText, Table2 } from 'lucide-react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types/unified-types'

interface PrintStyleScopePageProps {
  style: PrintStyle
  onStyleChange: (style: PrintStyle) => void
  scope: ExportType
  onScopeChange: (scope: ExportType) => void
  /** Whether the entity has a registered document type (quote/invoice) — resolved by the
   * wizard from the entity's `entityType` slug against `DOCUMENT_TYPE_DESCRIPTORS`. */
  hasDocumentType: boolean
  /** Present only when opened from the bulk-action bar — pins scope to 'selection'. */
  selectionCount?: number
}

/**
 * Print wizard page 1 — "Style & scope". Style is a `RadioGroupItemCard` per master style
 * (List / Detail sheet / Document) — all three are wired end-to-end (P2/P3/P4); Document
 * renders disabled with a "Not available for this entity" sublabel only when the entity has
 * no registered document type (plans/printing/01-unified-print.md §E). Scope is a plain
 * `FieldPanelRow` select below the cards — pinned to "Selected records" when the wizard was
 * opened from the bulk-action bar.
 */
export function PrintStyleScopePage({
  style,
  onStyleChange,
  scope,
  onScopeChange,
  hasDocumentType,
  selectionCount,
}: PrintStyleScopePageProps) {
  const scopeOptions =
    selectionCount != null
      ? [{ value: 'selection', label: `Selected records (${selectionCount})` }]
      : [
          { value: 'view', label: 'Current view' },
          { value: 'all', label: 'All records' },
        ]

  return (
    <div className='flex flex-col gap-4 p-3'>
      <RadioGroup
        value={style}
        onValueChange={(value) => onStyleChange(value as PrintStyle)}
        className='grid gap-2'>
        <RadioGroupItemCard
          value='list'
          label='List'
          icon={<Table2 />}
          description='Rows in a table — any entity.'
        />
        <RadioGroupItemCard
          value='detail'
          label='Detail sheet'
          icon={<FileText />}
          description='One section per record with the fields you choose.'
        />
        <RadioGroupItemCard
          value='document'
          label='Document'
          sublabel={hasDocumentType ? undefined : 'Not available for this entity'}
          icon={<FileStack />}
          description='Full formatted template per record (quote, invoice).'
          disabled={!hasDocumentType}
        />
      </RadioGroup>

      <FieldPanel
        orientation='responsive'
        resizeId='print-wizard'
        defaultLabelWidth={140}
        className='p-0'>
        <FieldPanelRow title='Scope' type={BaseType.ENUM} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: scopeOptions }}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            value={[scope]}
            onChange={(value) => onScopeChange((value as ExportType[])[0]!)}
            disabled={selectionCount != null}
          />
        </FieldPanelRow>
      </FieldPanel>
    </div>
  )
}
