// apps/web/src/components/print/ui/print-document-content-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { PrintOptionField } from '@auxx/lib/documents/client'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types/unified-types'

const COPY_OPTIONS = [
  { value: 'customer', label: 'Customer copy' },
  { value: 'office', label: 'Office copy' },
]

const COLLATION_OPTIONS = [
  { value: 'per_record', label: 'Per record (collated)' },
  { value: 'stacks', label: 'Stacks' },
]

interface PrintDocumentContentPageProps {
  copies: Array<'customer' | 'office'>
  onCopiesChange: (copies: Array<'customer' | 'office'>) => void
  collation: 'per_record' | 'stacks'
  onCollationChange: (collation: 'per_record' | 'stacks') => void
  /** The registered document type's type-specific extras (invoice's `sortBy`) — empty for
   * quote. Rendered generically off `PrintOptionField.type`, no per-type wizard UI. */
  printOptions: PrintOptionField[]
  /** Current values for `printOptions`, keyed by `PrintOptionField.key` — lands in
   * `printConfig.document.options`. */
  options: Record<string, unknown>
  onOptionsChange: (key: string, value: unknown) => void
}

/**
 * Print wizard "Content" page for the `document` style (P4) — replaces the column picker.
 * `copies`/`collation` are CORE document-mode fields rendered here for every registered
 * document type; `printOptions` are the registry's type-specific extras (invoice's `sortBy`),
 * rendered generically (plans/printing/01-unified-print.md §A "no per-type wizard UI code").
 */
export function PrintDocumentContentPage({
  copies,
  onCopiesChange,
  collation,
  onCollationChange,
  printOptions,
  options,
  onOptionsChange,
}: PrintDocumentContentPageProps) {
  return (
    <div className='flex flex-col gap-4 p-3'>
      <FieldPanel
        orientation='responsive'
        resizeId='print-wizard'
        defaultLabelWidth={140}
        className='p-0'>
        <FieldPanelRow
          title='Copies'
          type={BaseType.ENUM}
          showIcon
          description='Which copies to render for each record.'>
          <FieldInputAdapter
            fieldType={FieldType.MULTI_SELECT}
            fieldOptions={{ options: COPY_OPTIONS }}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            value={copies}
            onChange={(value) => onCopiesChange(value as Array<'customer' | 'office'>)}
          />
        </FieldPanelRow>
        <FieldPanelRow
          title='Collation'
          type={BaseType.ENUM}
          showIcon
          description='Order copies print in when both are included.'>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: COLLATION_OPTIONS }}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            value={[collation]}
            onChange={(value) => onCollationChange((value as ('per_record' | 'stacks')[])[0]!)}
          />
        </FieldPanelRow>
        {printOptions.map((field) => (
          <PrintOptionFieldRow
            key={field.key}
            field={field}
            value={options[field.key]}
            onChange={(value) => onOptionsChange(field.key, value)}
          />
        ))}
      </FieldPanel>
    </div>
  )
}

/** Generic renderer for one registry `PrintOptionField`, keyed on `.type` — `toggle` →
 * checkbox, `select`/`multi-select` → the same `FieldInputAdapter` select idiom the rest of
 * the wizard uses. */
function PrintOptionFieldRow({
  field,
  value,
  onChange,
}: {
  field: PrintOptionField
  value: unknown
  onChange: (value: unknown) => void
}) {
  switch (field.type) {
    case 'toggle':
      return (
        <FieldPanelRow title={field.label} type={BaseType.BOOLEAN} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            value={(value as boolean | undefined) ?? field.default}
            onChange={(v) => onChange(v as boolean)}
          />
        </FieldPanelRow>
      )
    case 'select':
      return (
        <FieldPanelRow title={field.label} type={BaseType.ENUM} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: field.options }}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            value={[(value as string | undefined) ?? field.default]}
            onChange={(v) => onChange((v as string[])[0])}
          />
        </FieldPanelRow>
      )
    case 'multi-select':
      return (
        <FieldPanelRow title={field.label} type={BaseType.ENUM} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.MULTI_SELECT}
            fieldOptions={{ options: field.options }}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            value={(value as string[] | undefined) ?? field.default}
            onChange={(v) => onChange(v as string[])}
          />
        </FieldPanelRow>
      )
    default:
      return null
  }
}
