// apps/web/src/components/print/ui/print-page-setup-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { PrintHeaderFooter, PrintStyle } from '@auxx/lib/export/client'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types/unified-types'

const PAPER_SIZE_OPTIONS = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
]

const ORIENTATION_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
]

const FIT_MODE_OPTIONS = [
  { value: 'shrink', label: 'Shrink to fit' },
  { value: 'wrap', label: 'Wrap cells' },
]

type PrintHeader = PrintHeaderFooter & { showLogo: boolean }

interface PrintPageSetupPageProps {
  style: PrintStyle
  paperSize: 'a4' | 'letter'
  onPaperSizeChange: (value: 'a4' | 'letter') => void
  orientation: 'auto' | 'portrait' | 'landscape'
  onOrientationChange: (value: 'auto' | 'portrait' | 'landscape') => void
  fitMode: 'shrink' | 'wrap'
  onFitModeChange: (value: 'shrink' | 'wrap') => void
  pageBreakPerRecord: boolean
  onPageBreakPerRecordChange: (value: boolean) => void
  header: PrintHeader
  onHeaderChange: (patch: Partial<PrintHeader>) => void
  footer: PrintHeaderFooter
  onFooterChange: (patch: Partial<PrintHeaderFooter>) => void
}

/**
 * Print wizard page 3 — "Page setup". Paper size / orientation always apply; fit mode is
 * list-style only, page-break-per-record is detail-style only. Header/footer slots are seeded
 * from `DEFAULT_PRINT_HEADER`/`DEFAULT_PRINT_FOOTER` by the caller — see `page-frame.tsx`'s
 * token substitution for what `{page}`/`{pages}`/`{date}`/`{orgName}`/`{viewName}`/`{count}`
 * resolve to at render time.
 */
export function PrintPageSetupPage({
  style,
  paperSize,
  onPaperSizeChange,
  orientation,
  onOrientationChange,
  fitMode,
  onFitModeChange,
  pageBreakPerRecord,
  onPageBreakPerRecordChange,
  header,
  onHeaderChange,
  footer,
  onFooterChange,
}: PrintPageSetupPageProps) {
  return (
    <div className='flex flex-col gap-4 p-3'>
      <FieldPanel
        orientation='responsive'
        resizeId='print-wizard'
        defaultLabelWidth={140}
        className='p-0'>
        <FieldPanelRow title='Paper size' type={BaseType.ENUM} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: PAPER_SIZE_OPTIONS }}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            value={[paperSize]}
            onChange={(value) => onPaperSizeChange((value as ('a4' | 'letter')[])[0]!)}
          />
        </FieldPanelRow>
        <FieldPanelRow title='Orientation' type={BaseType.ENUM} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: ORIENTATION_OPTIONS }}
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            value={[orientation]}
            onChange={(value) =>
              onOrientationChange((value as ('auto' | 'portrait' | 'landscape')[])[0]!)
            }
          />
        </FieldPanelRow>
        {style === 'list' && (
          <FieldPanelRow
            title='Fit mode'
            type={BaseType.ENUM}
            showIcon
            description='How the table fits the page width.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: FIT_MODE_OPTIONS }}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              value={[fitMode]}
              onChange={(value) => onFitModeChange((value as ('shrink' | 'wrap')[])[0]!)}
            />
          </FieldPanelRow>
        )}
        {style === 'detail' && (
          <FieldPanelRow
            title='One page per record'
            type={BaseType.BOOLEAN}
            showIcon
            description='On: each record starts a new page. Off: records flow continuously.'>
            <FieldInputAdapter
              fieldType={FieldType.CHECKBOX}
              value={pageBreakPerRecord}
              onChange={(value) => onPageBreakPerRecordChange(value as boolean)}
            />
          </FieldPanelRow>
        )}
      </FieldPanel>

      <div className='flex flex-col gap-1.5'>
        <p className='font-medium text-sm'>Header</p>
        <FieldPanel
          orientation='responsive'
          resizeId='print-wizard'
          defaultLabelWidth={140}
          className='p-0'>
          <FieldPanelRow title='Left' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={header.left ?? ''}
              onChange={(value) => onHeaderChange({ left: (value as string) || undefined })}
              placeholder='{orgName}'
            />
          </FieldPanelRow>
          <FieldPanelRow title='Center' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={header.center ?? ''}
              onChange={(value) => onHeaderChange({ center: (value as string) || undefined })}
              placeholder='{viewName}'
            />
          </FieldPanelRow>
          <FieldPanelRow title='Right' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={header.right ?? ''}
              onChange={(value) => onHeaderChange({ right: (value as string) || undefined })}
            />
          </FieldPanelRow>
          <FieldPanelRow title='Show logo' type={BaseType.BOOLEAN} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.CHECKBOX}
              value={header.showLogo}
              onChange={(value) => onHeaderChange({ showLogo: value as boolean })}
            />
          </FieldPanelRow>
        </FieldPanel>
      </div>

      <div className='flex flex-col gap-1.5'>
        <p className='font-medium text-sm'>Footer</p>
        <FieldPanel
          orientation='responsive'
          resizeId='print-wizard'
          defaultLabelWidth={140}
          className='p-0'>
          <FieldPanelRow title='Left' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={footer.left ?? ''}
              onChange={(value) => onFooterChange({ left: (value as string) || undefined })}
              placeholder='{date}'
            />
          </FieldPanelRow>
          <FieldPanelRow title='Center' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={footer.center ?? ''}
              onChange={(value) => onFooterChange({ center: (value as string) || undefined })}
            />
          </FieldPanelRow>
          <FieldPanelRow title='Right' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={footer.right ?? ''}
              onChange={(value) => onFooterChange({ right: (value as string) || undefined })}
              placeholder='Page {page} of {pages}'
            />
          </FieldPanelRow>
        </FieldPanel>
      </div>

      <p className='text-muted-foreground text-xs'>
        Available tokens: <code>{'{page}'}</code> <code>{'{pages}'}</code> <code>{'{date}'}</code>{' '}
        <code>{'{orgName}'}</code> <code>{'{viewName}'}</code> <code>{'{count}'}</code>
      </p>
    </div>
  )
}
