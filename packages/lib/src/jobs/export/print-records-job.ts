// packages/lib/src/jobs/export/print-records-job.ts

import { database as db, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { FieldReference } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { type DocumentProps, renderToBuffer } from '@react-pdf/renderer'
import { and, eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import type { ReactElement } from 'react'
import { createElement } from 'react'
import { getCachedOrgProfile, getCachedResource } from '../../cache'
import type { ConditionGroup } from '../../conditions/types'
import type { DocumentPdfPayload } from '../../documents/payload'
import { formatDocDate } from '../../documents/pdf/parts'
import { getDocumentType } from '../../documents/registry'
import { renderDocumentPdf } from '../../documents/render'
import {
  type ResolvedDocumentSettings,
  resolveDocumentSettings,
} from '../../documents/resolve-settings'
import type { ExportColumn, ExportJob, PrintConfig } from '../../export'
import {
  buildRow,
  type DetailSheetField,
  DetailSheetPdf,
  type DetailSheetRecord,
  fieldRefKey,
  getExportJobByOrg,
  indexByRecord,
  type PrintFrameTokens,
  publishExportJob,
  type RecordsTableColumn,
  RecordsTablePdf,
  updateExportJob,
} from '../../export'
import { FieldValueService } from '../../field-values/field-value-service'
import { MediaAssetService } from '../../files/core/media-asset-service'
import { StorageManager } from '../../files/storage/storage-manager'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import type { JobContext } from '../types'
import { fetchValues, hydrateDisplayNames, hydrateRelationNames, PAGE_SIZE } from './shared'

const logger = createScopedLogger('print-records-job')

/**
 * Hard cap for `style: 'list'` print runs — react-pdf holds the whole document tree (every
 * page's element tree) in memory for `renderToBuffer`, so this is a memory/latency guard,
 * not a UX nicety. No silent truncation: runs over the cap fail with a clear message
 * (plans/printing/01-unified-print.md §D).
 */
export const MAX_PRINT_RECORDS_LIST = 5000

/**
 * Hard cap for `style: 'detail'` print runs — lower than {@link MAX_PRINT_RECORDS_LIST} because
 * every record renders its own heading + field grid (and typically its own page), so the
 * per-record cost (both react-pdf's in-memory tree and the extra `getByIds` display-name
 * hydration) is higher than one list row (plans/printing/01-unified-print.md §D "1k detail").
 */
export const MAX_PRINT_RECORDS_DETAIL = 1000

/**
 * Hard cap for `style: 'document'` print runs — the priciest style per record: a full
 * react-pdf `<Document>` render per copy (0.5–2s each), so a 500-record × 2-copy run is
 * already ~10–30 minutes. Orchestrator decision (the plan is silent on a document-specific
 * cap) — loud failure via {@link assertUnderCap}, same as list/detail, no silent truncation.
 */
export const MAX_PRINT_RECORDS_DOCUMENT = 500

/** Job payload for printing entity records to a PDF (list + detail styles — P2/P3). */
export interface PrintRecordsJobData {
  exportJobId: string
  organizationId: string
}

/**
 * Background job: render entity records to a PDF in S3, driven by a snapshotted `ExportJob`
 * (same table as the CSV export path — `format: 'pdf'` + `printConfig`). Mirrors
 * `exportRecordsJob`'s paging/hydration/progress/realtime/error-handling shape via the shared
 * `./shared` helpers; the only real difference is the final render step (react-pdf instead of
 * CSV serialization) and the `'selection'` scope's `recordIds`-array paging.
 *
 * `style: 'list'` and `style: 'detail'` share the same paging/formatting accumulation via
 * {@link collectRows}; `style: 'document'` (P4) renders per-record react-pdf documents via the
 * registry's `buildPayload`/`renderDocumentPdf` directly (never `ensureDocumentPdf` — no
 * pointer writes, no content-hash cache pollution, plans/printing/01-unified-print.md locked
 * decision 7) and merges the per-copy buffers with `pdf-lib` (locked decision 8).
 */
export async function printRecordsJob(ctx: JobContext<PrintRecordsJobData>): Promise<void> {
  const { exportJobId, organizationId } = ctx.data
  logger.info('Starting print run', { exportJobId, organizationId })

  const job = await getExportJobByOrg(db, organizationId, exportJobId)
  if (!job) {
    throw new Error(`Export job not found: ${exportJobId}`)
  }

  const printConfig = job.printConfig
  if (!printConfig) {
    throw new Error(`Print job ${exportJobId} is missing printConfig`)
  }

  await updateExportJob(db, exportJobId, { status: 'processing', startedAt: new Date() })
  await publishExportJob(organizationId, { exportJobId, kind: 'started', status: 'processing' })

  let storageLocationId: string | null = null
  try {
    const buffer = await renderPrint(ctx, job, printConfig)
    const fileName = pdfFileName(job.fileName, exportJobId)

    const storage = new StorageManager(organizationId)
    const location = await storage.uploadContent({
      provider: 'S3',
      key: `prints/${organizationId}/${exportJobId}/${fileName}`,
      content: buffer,
      mimeType: 'application/pdf',
      size: buffer.byteLength,
      visibility: 'PRIVATE',
    })
    storageLocationId = location.id

    await updateExportJob(db, exportJobId, {
      status: 'completed',
      storageLocationId: location.id,
      fileName,
      fileSizeBytes: buffer.byteLength,
      completedAt: new Date(),
    })
    await publishExportJob(organizationId, {
      exportJobId,
      kind: 'finished',
      status: 'completed',
      fileName,
    })
    logger.info('Print run completed', { exportJobId, bytes: buffer.byteLength })
  } catch (error) {
    // If the upload succeeded but a later write failed, drop the orphaned object.
    if (storageLocationId) {
      await new StorageManager(organizationId).deleteFile(storageLocationId).catch(() => {})
    }
    const message = error instanceof Error ? error.message : String(error)
    await updateExportJob(db, exportJobId, {
      status: 'failed',
      error: message,
      completedAt: new Date(),
    })
    await publishExportJob(organizationId, { exportJobId, kind: 'finished', status: 'failed' })
    logger.error('Print run failed', { exportJobId, error: message })
    throw error
  }
}

/** Dispatch on print style. */
async function renderPrint(
  ctx: JobContext<PrintRecordsJobData>,
  job: ExportJob,
  printConfig: PrintConfig
): Promise<Buffer> {
  switch (printConfig.style) {
    case 'list':
      return renderListPrint(ctx, job, printConfig)
    case 'detail':
      return renderDetailPrint(ctx, job, printConfig)
    case 'document':
      return renderDocumentPrint(ctx, job, printConfig)
    default:
      throw new Error(`Unknown print style: ${String((printConfig as PrintConfig).style)}`)
  }
}

/** {@link collectRows}'s accumulated output — the paged, formatted, progress-reported result
 * both `list` and `detail` styles render from. */
interface CollectedRows {
  /** Pre-formatted display strings, one row per record, in run order. */
  rows: string[][]
  /** Record ids, same order as `rows` — `rows[i]`/`ids[i]` are the same record. Only needed by
   * the `detail` style (to look up each record's own display name); `list` ignores it. */
  ids: RecordId[]
  /** First-seen `FieldType` per column (a page can be empty for a field on every record it
   * covers, hence `undefined` slots). */
  fieldTypes: Array<FieldType | undefined>
  total: number
  /** Printed records' OWN display names, keyed by their RecordId — populated only when
   * `needDisplayNames` is set (detail style only; the list style has no heading to fill). */
  displayNames: Map<RecordId, string>
}

/**
 * Page the run's records (same `listFiltered` snapshot as CSV for `'view'`/`'all'`, or the
 * job's frozen `recordIds` array in `PAGE_SIZE` chunks for `'selection'`) and format cells
 * exactly like the CSV job (`buildRow`/`formatCell` — zero new formatting logic), bumping
 * progress/realtime per page. Shared by `renderListPrint` and `renderDetailPrint` — the two
 * styles differ only in what they do with the accumulated rows afterward (one wide table vs.
 * one label/value grid per record) and in `cap`/`needDisplayNames`.
 */
async function collectRows(
  ctx: JobContext<PrintRecordsJobData>,
  job: ExportJob,
  columns: ExportColumn[],
  opts: { cap: number; needDisplayNames: boolean; styleLabel: string }
): Promise<CollectedRows> {
  const { organizationId, exportJobId } = ctx.data
  const fieldRefs = columns.map((c) => c.fieldRef as FieldReference)
  const columnIndexByKey = new Map(columns.map((c, i) => [fieldRefKey(c.fieldRef), i]))
  const fieldTypes = new Array<FieldType | undefined>(columns.length).fill(undefined)

  const handler = new UnifiedCrudHandler(organizationId, job.createdById, db)
  const fvs = new FieldValueService(organizationId, job.createdById, db)

  const nameCache = new Map<RecordId, string>()
  const displayNames = new Map<RecordId, string>()
  const rows: string[][] = []
  const ids: RecordId[] = []
  let processed = 0
  let total = 0

  /** Format + accumulate one page's records into `rows`/`ids`, bumping progress/realtime. */
  async function processPage(pageIds: RecordId[]): Promise<void> {
    if (pageIds.length === 0) return
    const results = await fetchValues(fvs, pageIds, fieldRefs)
    await hydrateRelationNames(handler, results, nameCache)
    if (opts.needDisplayNames) await hydrateDisplayNames(handler, pageIds, displayNames)
    for (const result of results) {
      const idx = columnIndexByKey.get(fieldRefKey(result.fieldRef))
      if (idx !== undefined && fieldTypes[idx] === undefined) fieldTypes[idx] = result.fieldType
    }
    const byRecord = indexByRecord(results)
    for (const id of pageIds) {
      rows.push(buildRow(id, columns, byRecord, nameCache))
      ids.push(id)
    }

    processed += pageIds.length
    await updateExportJob(db, exportJobId, { processedRecords: processed })
    if (total > 0) await ctx.updateProgress(Math.round((processed / total) * 100))
    await publishExportJob(organizationId, { exportJobId, kind: 'progress', processed, total })
  }

  if (job.exportType === 'selection') {
    const recordIds = (job.recordIds ?? []) as RecordId[]
    total = recordIds.length
    assertUnderCap(total, job.exportType, opts.cap, opts.styleLabel)
    await updateExportJob(db, exportJobId, { totalRecords: total })

    for (let offset = 0; offset < recordIds.length; offset += PAGE_SIZE) {
      ctx.throwIfCancelled()
      await processPage(recordIds.slice(offset, offset + PAGE_SIZE))
    }
  } else {
    const filters = (job.filters ?? undefined) as ConditionGroup[] | undefined
    const sorting = job.sorting ?? undefined

    let page = await handler.listFiltered({
      entityDefinitionId: job.entityDefinitionId,
      filters,
      sorting,
      limit: PAGE_SIZE,
      mode: 'snapshot',
    })
    total = page.total
    assertUnderCap(total, job.exportType, opts.cap, opts.styleLabel)
    await updateExportJob(db, exportJobId, { totalRecords: total })

    while (true) {
      ctx.throwIfCancelled()
      const pageIds = page.ids.map((id) => toRecordId(job.entityDefinitionId, id))
      await processPage(pageIds)
      if (!page.hasMore) break
      page = await handler.listFiltered({
        entityDefinitionId: job.entityDefinitionId,
        filters,
        sorting,
        limit: PAGE_SIZE,
        cursor: { snapshotId: page.snapshotId, offset: processed },
      })
    }
  }

  return { rows, ids, fieldTypes, total, displayNames }
}

/**
 * Render the `list` print style: {@link collectRows} the run, then render ONE react-pdf
 * `<RecordsTablePdf>` document from the formatted rows.
 */
async function renderListPrint(
  ctx: JobContext<PrintRecordsJobData>,
  job: ExportJob,
  printConfig: PrintConfig
): Promise<Buffer> {
  const { organizationId } = ctx.data
  const columns = job.columns as ExportColumn[]
  const { rows, fieldTypes, total } = await collectRows(ctx, job, columns, {
    cap: MAX_PRINT_RECORDS_LIST,
    needDisplayNames: false,
    styleLabel: 'list',
  })

  const settings = await resolveDocumentSettings(organizationId)
  const logoBytes = await loadLogoBytes(organizationId, printConfig.header.showLogo, settings)
  const viewName = await resolveViewName(organizationId, job)
  const orgProfile = await getCachedOrgProfile(organizationId)

  const tokens: PrintFrameTokens = {
    date: formatDocDate(new Date().toISOString(), settings.branding.dateFormat),
    orgName: orgProfile?.name ?? '',
    viewName,
    count: total,
  }
  const resolvedConfig: PrintConfig = {
    ...printConfig,
    paperSize: printConfig.paperSize ?? settings.branding.paperSize,
  }
  const tableColumns: RecordsTableColumn[] = columns.map((c, i) => ({
    label: c.label,
    fieldType: fieldTypes[i],
  }))

  const element = createElement(RecordsTablePdf, {
    settings,
    logoBytes,
    config: resolvedConfig,
    columns: tableColumns,
    rows,
    tokens,
  })
  // `renderToBuffer` types its argument as `ReactElement<DocumentProps>` (the root
  // `<Document>`) — `RecordsTablePdf` is a component that RETURNS one, same caveat as
  // `documents/render.ts`'s `renderDocumentPdf`.
  return renderToBuffer(element as unknown as ReactElement<DocumentProps>)
}

/**
 * Render the `detail` print style: {@link collectRows} the run (with display-name hydration
 * for the printed records themselves, not just their relation targets), then render ONE
 * react-pdf `<DetailSheetPdf>` document — one heading + label/value grid per record.
 */
async function renderDetailPrint(
  ctx: JobContext<PrintRecordsJobData>,
  job: ExportJob,
  printConfig: PrintConfig
): Promise<Buffer> {
  const { organizationId } = ctx.data
  const columns = job.columns as ExportColumn[]
  const { rows, ids, total, displayNames } = await collectRows(ctx, job, columns, {
    cap: MAX_PRINT_RECORDS_DETAIL,
    needDisplayNames: true,
    styleLabel: 'detail',
  })

  const settings = await resolveDocumentSettings(organizationId)
  const logoBytes = await loadLogoBytes(organizationId, printConfig.header.showLogo, settings)
  const viewName = await resolveViewName(organizationId, job)
  const orgProfile = await getCachedOrgProfile(organizationId)

  const tokens: PrintFrameTokens = {
    date: formatDocDate(new Date().toISOString(), settings.branding.dateFormat),
    orgName: orgProfile?.name ?? '',
    viewName,
    count: total,
  }
  const resolvedConfig: PrintConfig = {
    ...printConfig,
    paperSize: printConfig.paperSize ?? settings.branding.paperSize,
  }
  const fields: DetailSheetField[] = columns.map((c) => ({ label: c.label }))
  const records: DetailSheetRecord[] = ids.map((id, i) => ({
    displayName: displayNames.get(id) ?? '',
    values: rows[i] ?? [],
  }))

  const element = createElement(DetailSheetPdf, {
    settings,
    logoBytes,
    config: resolvedConfig,
    fields,
    records,
    tokens,
  })
  // Same `<Document>`-returning-component caveat as `renderListPrint`'s `RecordsTablePdf` call.
  return renderToBuffer(element as unknown as ReactElement<DocumentProps>)
}

/** Natural/numeric-aware compare for document numbers (`INV-9` before `INV-10`). */
const NUMERIC_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** One record's built payload, carried alongside its id through sort + render. */
interface BuiltDocumentRecord {
  recordId: RecordId
  payload: DocumentPdfPayload
}

/** Compare two built records by the invoice `sortBy` option's field (plans/printing/
 * 01-unified-print.md §D). `'date'` compares `issuedAt` chronologically; `'number'`/`'contact'`
 * are natural-sort string compares (so `INV-9` sorts before `INV-10`). */
function compareBuiltRecords(
  a: BuiltDocumentRecord,
  b: BuiltDocumentRecord,
  sortBy: string
): number {
  if (sortBy === 'date') {
    return new Date(a.payload.issuedAt).getTime() - new Date(b.payload.issuedAt).getTime()
  }
  const keyOf = (r: BuiltDocumentRecord) =>
    sortBy === 'contact' ? r.payload.contact.name : r.payload.number
  return NUMERIC_COLLATOR.compare(keyOf(a), keyOf(b))
}

/** Which copy kinds to render, always in `customer, office` order — the FINAL merge order is
 * decided by `collation` in {@link renderDocumentPrint}, this only decides which kinds exist at
 * all. Empty `copies` (shouldn't happen — the wizard always sends at least one) falls back to
 * both rather than producing an empty PDF. */
function resolveCopyKinds(copies: Array<'customer' | 'office'>): Array<'customer' | 'office'> {
  const requested = new Set(copies.length > 0 ? copies : (['customer', 'office'] as const))
  return (['customer', 'office'] as const).filter((kind) => requested.has(kind))
}

/**
 * Gather record ids for the `document` print style, in run order — ids ONLY, no field-value
 * fetch (`columns` is `[]` for document mode, unlike {@link collectRows}). `'selection'` keeps
 * the frozen `recordIds` order; `'view'`/`'all'` page the same `listFiltered` snapshot
 * list/detail use.
 */
async function collectDocumentRecordIds(
  ctx: JobContext<PrintRecordsJobData>,
  job: ExportJob
): Promise<RecordId[]> {
  const { organizationId, exportJobId } = ctx.data

  if (job.exportType === 'selection') {
    const recordIds = (job.recordIds ?? []) as RecordId[]
    assertUnderCap(recordIds.length, job.exportType, MAX_PRINT_RECORDS_DOCUMENT, 'document')
    await updateExportJob(db, exportJobId, { totalRecords: recordIds.length })
    return recordIds
  }

  const handler = new UnifiedCrudHandler(organizationId, job.createdById, db)
  const filters = (job.filters ?? undefined) as ConditionGroup[] | undefined
  const sorting = job.sorting ?? undefined
  const ids: RecordId[] = []

  let page = await handler.listFiltered({
    entityDefinitionId: job.entityDefinitionId,
    filters,
    sorting,
    limit: PAGE_SIZE,
    mode: 'snapshot',
  })
  assertUnderCap(page.total, job.exportType, MAX_PRINT_RECORDS_DOCUMENT, 'document')
  await updateExportJob(db, exportJobId, { totalRecords: page.total })

  while (true) {
    ctx.throwIfCancelled()
    ids.push(...page.ids.map((id) => toRecordId(job.entityDefinitionId, id)))
    if (!page.hasMore) break
    page = await handler.listFiltered({
      entityDefinitionId: job.entityDefinitionId,
      filters,
      sorting,
      limit: PAGE_SIZE,
      cursor: { snapshotId: page.snapshotId, offset: ids.length },
    })
  }

  return ids
}

/**
 * Render the `document` print style (P4): resolve the registry entry, gather record ids,
 * `buildPayload` every record, sort (unless `'selection'`), render each requested copy via
 * `renderDocumentPdf` directly — NEVER `ensureDocumentPdf` (no pointer writes, no
 * content-hash cache pollution from label variants, plans/printing/01-unified-print.md locked
 * decision 7) — then merge every buffer into ONE PDF with `pdf-lib` in the chosen collation
 * order (locked decision 8).
 */
async function renderDocumentPrint(
  ctx: JobContext<PrintRecordsJobData>,
  job: ExportJob,
  printConfig: PrintConfig
): Promise<Buffer> {
  const { organizationId, exportJobId } = ctx.data
  const documentConfig = printConfig.document
  if (!documentConfig) {
    throw new Error(`Print job ${exportJobId} is missing printConfig.document`)
  }

  const documentType = getDocumentType(documentConfig.documentTypeId)
  if (!documentType) {
    throw new Error(`Unregistered document type: ${documentConfig.documentTypeId}`)
  }
  if (documentType.entityDefinitionId !== job.entityDefinitionId) {
    throw new Error(
      `Document type "${documentConfig.documentTypeId}" prints "${documentType.entityDefinitionId}" ` +
        `records, but this print job targets "${job.entityDefinitionId}"`
    )
  }

  const recordIds = await collectDocumentRecordIds(ctx, job)
  const copyKinds = resolveCopyKinds(documentConfig.copies)

  // Build every record's payload up front — sort keys (number/date/contact) only exist once
  // the payload is built.
  const built: BuiltDocumentRecord[] = []
  for (const recordId of recordIds) {
    ctx.throwIfCancelled()
    const { payload } = await documentType.buildPayload({
      organizationId,
      userId: job.createdById,
      recordId,
    })
    built.push({ recordId, payload })
  }

  // 'selection' keeps the frozen selection order. Otherwise sort by the invoice `sortBy`
  // option, defaulting to 'number' when the invoice type is registered but the wizard didn't
  // set one; quote has no `sortBy` printOption (its `options.sortBy` is never set), so quote
  // runs always keep the given (listFiltered) order.
  const sortBy =
    (documentConfig.options?.sortBy as string | undefined) ??
    (documentType.id === 'invoice' ? 'number' : undefined)
  if (job.exportType !== 'selection' && sortBy) {
    built.sort((a, b) => compareBuiltRecords(a, b, sortBy))
  }

  // Render every requested copy per record (in final run order), ticking progress once per
  // record — `total` is the record count, not the copy count.
  const buffersByRecord: Array<Map<'customer' | 'office', Buffer>> = []
  let processed = 0
  for (const { payload } of built) {
    ctx.throwIfCancelled()
    const copies = new Map<'customer' | 'office', Buffer>()
    for (const kind of copyKinds) {
      const copyLabel = kind === 'office' ? 'Office Copy' : undefined
      copies.set(kind, await renderDocumentPdf(payload, { copyLabel }))
    }
    buffersByRecord.push(copies)

    processed += 1
    await updateExportJob(db, exportJobId, { processedRecords: processed })
    if (built.length > 0) await ctx.updateProgress(Math.round((processed / built.length) * 100))
    await publishExportJob(organizationId, {
      exportJobId,
      kind: 'progress',
      processed,
      total: built.length,
    })
  }

  // Collation decides the merge order: 'per_record' interleaves each record's copies
  // (customer, office — staple-ready); 'stacks' groups every customer copy first, then every
  // office copy. Only requested copy kinds (`copyKinds`) ever appear.
  const orderedBuffers: Buffer[] =
    documentConfig.collation === 'stacks'
      ? copyKinds.flatMap((kind) =>
          buffersByRecord.map((copies) => copies.get(kind)).filter((b): b is Buffer => b != null)
        )
      : buffersByRecord.flatMap((copies) =>
          copyKinds.map((kind) => copies.get(kind)).filter((b): b is Buffer => b != null)
        )

  const merged = await PDFDocument.create()
  for (const buffer of orderedBuffers) {
    const doc = await PDFDocument.load(buffer)
    const pages = await merged.copyPages(doc, doc.getPageIndices())
    for (const page of pages) merged.addPage(page)
  }

  return Buffer.from(await merged.save())
}

/** Fail loudly (no silent truncation) once a print run exceeds its style's record cap
 * ({@link MAX_PRINT_RECORDS_LIST} / {@link MAX_PRINT_RECORDS_DETAIL} /
 * {@link MAX_PRINT_RECORDS_DOCUMENT}). */
function assertUnderCap(total: number, exportType: string, cap: number, styleLabel: string): void {
  if (total <= cap) return
  logger.warn('Print run exceeds record cap', { total, exportType, cap, style: styleLabel })
  throw new Error(
    `This print run has ${total} records, which exceeds the ${cap}-record limit for ` +
      `${styleLabel}-style prints. Narrow the view/filters or selection and try again.`
  )
}

/** Load the org's logo bytes for the header band — mirrors `documents/render.ts`'s pattern
 * (react-pdf `<Image>` always gets a Buffer, never a URL). A missing/deleted logo asset
 * renders without a logo rather than failing the whole print run. */
async function loadLogoBytes(
  organizationId: string,
  showLogo: boolean,
  settings: ResolvedDocumentSettings
): Promise<Buffer | null> {
  if (!showLogo) return null
  const logoAssetId = settings.branding.logo?.assetId
  if (!logoAssetId) return null
  try {
    return await new MediaAssetService(organizationId).getContent(logoAssetId)
  } catch {
    return null
  }
}

/**
 * Resolve the `{viewName}` token. `ExportJob` has no view-name column — `viewId` (when set)
 * points at a `TableView` row, which does have a `name`; fall back to the entity's cached
 * display label (`Resource.label`) when there's no view id, the view was deleted, or the run
 * is entity-wide ('all'/'selection' scopes commonly have no `viewId`). Keeps the token
 * resolvable in every case without a new column on the job.
 */
async function resolveViewName(organizationId: string, job: ExportJob): Promise<string> {
  if (job.viewId) {
    const view = await db.query.TableView.findFirst({
      where: and(
        eq(schema.TableView.id, job.viewId),
        eq(schema.TableView.organizationId, organizationId)
      ),
    })
    if (view?.name) return view.name
  }
  const resource = await getCachedResource(organizationId, job.entityDefinitionId)
  return resource?.label ?? job.entityDefinitionId
}

/** `job.fileName` (if set) with a `.pdf` extension, else `print-<jobId>.pdf`. */
function pdfFileName(fileName: string | null, jobId: string): string {
  const base = fileName?.trim() || `print-${jobId}`
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`
}
