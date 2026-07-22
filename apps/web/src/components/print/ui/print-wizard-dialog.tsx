// apps/web/src/components/print/ui/print-wizard-dialog.tsx

'use client'

import { DOCUMENT_TYPE_DESCRIPTORS } from '@auxx/lib/documents/client'
import {
  DEFAULT_PRINT_FOOTER,
  DEFAULT_PRINT_HEADER,
  type ExportType,
  type PrintConfig,
  type PrintHeaderFooter,
  type PrintStyle,
} from '@auxx/lib/export/client'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useResources } from '~/components/resources'
import { api } from '~/trpc/react'
import {
  useActiveView,
  useActiveViewId,
  useTableFilters,
  useTableSorting,
} from '../../dynamic-table/stores/store-selectors'
import { usePrintColumns } from '../hooks/use-print-columns'
import { PrintColumnPicker } from './print-column-picker'
import { PrintDocumentContentPage } from './print-document-content-page'
import { PrintPageSetupPage } from './print-page-setup-page'
import { PrintStyleScopePage } from './print-style-scope-page'

type WizardPage = 'style-scope' | 'content' | 'page-setup' | 'run'

const PAGE_TITLES: Record<WizardPage, string> = {
  'style-scope': 'Style & scope',
  content: 'Content',
  'page-setup': 'Page setup',
  run: 'Run',
}

interface PrintWizardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityDefinitionId: string
  tableId: string
  /** Present only when opened from the bulk-action bar — pins scope to 'selection'. */
  selection?: { recordIds: RecordId[] }
  /**
   * Called with the created export job's id once the print run is enqueued. The caller owns
   * the progress dialog (`ExportProgressDialog`) from there — exactly like the CSV export
   * flow (`table-toolbar.tsx`'s `exportJobId`/`exportDialogOpen`).
   */
  onCreated: (jobId: string) => void
}

/**
 * Unified PDF print wizard (plans/printing/01-unified-print.md §E). Up to four pages via
 * `DialogNav`/`DialogNavPages`: Style & scope → Content → Page setup → Run — all three master
 * styles (list/detail/document) are wired end-to-end (P2/P3/P4). Content is the shared
 * column/field picker for list/detail, or the document-specific copies/collation/printOptions
 * page for `document`; "Page setup" is skipped for `document` (its per-document template
 * controls its own layout, nothing there applies). Document preselects as the initial style
 * when the entity has a registered document type (entered from a quote/invoice table).
 */
export function PrintWizardDialog({
  open,
  onOpenChange,
  entityDefinitionId,
  tableId,
  selection,
  onCreated,
}: PrintWizardDialogProps) {
  const { getResourceById } = useResources()
  const resource = getResourceById(entityDefinitionId)

  // The registered document type for this entity, if any (quote/invoice today) — drives
  // whether the Document style card is enabled and preselects it when entered from a
  // quote/invoice table (plans/printing/01-unified-print.md §E page 1).
  const documentDescriptor = useMemo(
    () => DOCUMENT_TYPE_DESCRIPTORS.find((d) => d.entityDefinitionId === entityDefinitionId),
    [entityDefinitionId]
  )

  const [page, setPage] = useState<WizardPage>('style-scope')
  const [style, setStyle] = useState<PrintStyle>(() => (documentDescriptor ? 'document' : 'list'))
  const [scope, setScope] = useState<ExportType>(selection ? 'selection' : 'view')

  const [paperSize, setPaperSize] = useState<'a4' | 'letter'>('letter')
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto')
  const [fitMode, setFitMode] = useState<'shrink' | 'wrap'>('shrink')
  const [pageBreakPerRecord, setPageBreakPerRecord] = useState(true)
  const [header, setHeader] = useState<PrintHeaderFooter & { showLogo: boolean }>(
    DEFAULT_PRINT_HEADER
  )
  const [footer, setFooter] = useState<PrintHeaderFooter>(DEFAULT_PRINT_FOOTER)

  // Document style's own content-page state — copies/collation are CORE document fields;
  // `documentOptions` holds the registry's type-specific extras (invoice's `sortBy`), seeded
  // from each field's `default`.
  const [documentCopies, setDocumentCopies] = useState<Array<'customer' | 'office'>>([
    'customer',
    'office',
  ])
  const [documentCollation, setDocumentCollation] = useState<'per_record' | 'stacks'>('per_record')
  const [documentOptions, setDocumentOptions] = useState<Record<string, unknown>>(() =>
    Object.fromEntries((documentDescriptor?.printOptions ?? []).map((f) => [f.key, f.default]))
  )

  const columns = usePrintColumns(tableId, entityDefinitionId)

  // Same view/filter/sort source as the CSV export flow (`table-toolbar.tsx`).
  const activeViewId = useActiveViewId(tableId)
  const currentView = useActiveView(tableId)
  const filters = useTableFilters(tableId)
  const sorting = useTableSorting(tableId)

  const createPrint = api.dataExport.create.useMutation()

  // Document style has nothing to configure on "Page setup" — its per-document template
  // controls paper size/orientation/header/footer, not the generic print frame — so that page
  // is skipped entirely rather than shown empty (plans/printing/01-unified-print.md §E page 3).
  const pageOrder: WizardPage[] = useMemo(
    () =>
      style === 'document'
        ? ['style-scope', 'content', 'run']
        : ['style-scope', 'content', 'page-setup', 'run'],
    [style]
  )
  const pageIndex = pageOrder.indexOf(page)
  const goBack = () => {
    if (pageIndex > 0) setPage(pageOrder[pageIndex - 1]!)
  }
  const contentContinueTarget = style === 'document' ? 'run' : 'page-setup'

  const summary = useMemo(() => {
    const scopeLabel =
      scope === 'view'
        ? (currentView?.name ?? 'Current view')
        : scope === 'all'
          ? 'All records'
          : `Selected records (${selection?.recordIds.length ?? 0})`
    const styleLabel =
      style === 'detail' ? 'Detail sheet' : style === 'document' ? 'Document' : 'List'
    return { scopeLabel, styleLabel }
  }, [scope, currentView, selection, style])

  const isDocumentStyle = style === 'document'
  const canContinueFromContent = isDocumentStyle
    ? documentCopies.length > 0
    : columns.selected.length > 0

  const handlePrint = async () => {
    if (!entityDefinitionId) return

    const dateStamp = new Date().toISOString().slice(0, 10)
    const base =
      scope === 'view' ? (currentView?.name ?? resource?.label ?? 'view') : `${scope}-records`
    const slug =
      base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'print'

    const printConfig: PrintConfig = {
      style,
      paperSize,
      orientation,
      header,
      footer,
      ...(style === 'list' ? { list: { fitMode } } : {}),
      ...(style === 'detail' ? { detail: { pageBreakPerRecord } } : {}),
      ...(isDocumentStyle && documentDescriptor
        ? {
            document: {
              documentTypeId: documentDescriptor.id,
              copies: documentCopies,
              collation: documentCollation,
              options: documentOptions,
            },
          }
        : {}),
    }

    try {
      const { id } = await createPrint.mutateAsync({
        entityDefinitionId,
        exportType: scope,
        tableId,
        viewId: scope === 'view' ? (activeViewId ?? undefined) : undefined,
        filters: scope === 'view' ? filters : undefined,
        sorting: scope === 'view' ? sorting : undefined,
        columns: isDocumentStyle
          ? []
          : columns.selected.map((c) => ({ label: c.label, fieldRef: c.fieldRef })),
        format: 'pdf',
        printConfig,
        recordIds: scope === 'selection' ? selection?.recordIds : undefined,
        fileName: `${slug}-${dateStamp}.pdf`,
      })
      onOpenChange(false)
      onCreated(id)
    } catch (error) {
      toastError({
        title: 'Print failed to start',
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent innerClassName='p-0' position='tc' size='content'>
        <div className='flex flex-col'>
          <DialogNav
            title={`Print ${resource?.plural ?? 'records'}`}
            description='Print or save records to a PDF.'
            onBack={page === 'style-scope' ? undefined : goBack}
            crumbs={[{ label: PAGE_TITLES[page], icon: <Printer /> }]}
          />

          <DialogNavPages value={page}>
            <DialogNavPage value='style-scope' size='sm'>
              <PrintStyleScopePage
                style={style}
                onStyleChange={setStyle}
                scope={scope}
                onScopeChange={setScope}
                entityDefinitionId={entityDefinitionId}
                selectionCount={selection?.recordIds.length}
              />
            </DialogNavPage>

            <DialogNavPage value='content' size='md'>
              {isDocumentStyle ? (
                <PrintDocumentContentPage
                  copies={documentCopies}
                  onCopiesChange={setDocumentCopies}
                  collation={documentCollation}
                  onCollationChange={setDocumentCollation}
                  printOptions={documentDescriptor?.printOptions ?? []}
                  options={documentOptions}
                  onOptionsChange={(key, value) =>
                    setDocumentOptions((prev) => ({ ...prev, [key]: value }))
                  }
                />
              ) : (
                <div className='p-3'>
                  <PrintColumnPicker
                    columns={columns}
                    entityDefinitionId={entityDefinitionId}
                    style={style}
                  />
                </div>
              )}
            </DialogNavPage>

            <DialogNavPage value='page-setup' size='md'>
              <PrintPageSetupPage
                style={style}
                paperSize={paperSize}
                onPaperSizeChange={setPaperSize}
                orientation={orientation}
                onOrientationChange={setOrientation}
                fitMode={fitMode}
                onFitModeChange={setFitMode}
                pageBreakPerRecord={pageBreakPerRecord}
                onPageBreakPerRecordChange={setPageBreakPerRecord}
                header={header}
                onHeaderChange={(patch) => setHeader((prev) => ({ ...prev, ...patch }))}
                footer={footer}
                onFooterChange={(patch) => setFooter((prev) => ({ ...prev, ...patch }))}
              />
            </DialogNavPage>

            <DialogNavPage value='run' size='sm'>
              <div className='flex flex-col gap-2 p-3'>
                <div className='flex flex-col gap-2 rounded-md border p-4 text-sm'>
                  <SummaryRow label='Style' value={summary.styleLabel} />
                  <SummaryRow label='Scope' value={summary.scopeLabel} />
                  {isDocumentStyle ? (
                    <>
                      <SummaryRow
                        label='Copies'
                        value={
                          documentCopies
                            .map((c) => (c === 'office' ? 'Office' : 'Customer'))
                            .join(' + ') || 'None'
                        }
                      />
                      <SummaryRow
                        label='Collation'
                        value={documentCollation === 'stacks' ? 'Stacks' : 'Per record'}
                      />
                    </>
                  ) : (
                    <>
                      <SummaryRow
                        label={style === 'detail' ? 'Fields' : 'Columns'}
                        value={String(columns.selected.length)}
                      />
                      <SummaryRow
                        label='Paper'
                        value={`${paperSize.toUpperCase()} · ${orientation}`}
                      />
                    </>
                  )}
                </div>
                <p className='text-muted-foreground text-xs'>
                  Runs in the background — you'll see live progress and a download link once it's
                  ready.
                </p>
              </div>
            </DialogNavPage>
          </DialogNavPages>

          <DialogFooter className='mt-0 border-t p-3'>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => onOpenChange(false)}
              disabled={createPrint.isPending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            {page === 'style-scope' && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => setPage('content')}
                data-dialog-submit>
                Continue <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
            {page === 'content' && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => setPage(contentContinueTarget)}
                disabled={!canContinueFromContent}
                data-dialog-submit>
                Continue <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
            {page === 'page-setup' && (
              <Button size='sm' variant='outline' onClick={() => setPage('run')} data-dialog-submit>
                Continue <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
            {page === 'run' && (
              <Button
                size='sm'
                variant='outline'
                onClick={handlePrint}
                loading={createPrint.isPending}
                loadingText='Starting...'
                data-dialog-submit>
                Print <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-start justify-between gap-4'>
      <span className='shrink-0 text-muted-foreground'>{label}</span>
      <span className='truncate text-right font-medium'>{value}</span>
    </div>
  )
}
