// packages/lib/src/postings/reports/pdf/render-statement-pdf.ts
//
// `renderStatementPdf`: the non-record PDF render for the three financial
// statements, modelled on `documents/preview-pdf.ts` - build a payload,
// `renderToBuffer`, upload through `createStorageManager(orgId).uploadContent`,
// `createAssetWithVersion` with purpose `PREVIEW` and an `expiresAt`, return
// the asset id. Like `preview-pdf.ts`, this imports the default database
// directly rather than taking `db` as a parameter (`ui-plan.md` §5.2's own
// precedent for a non-record render) - the alternative would push `db`
// threading through a signature the router calls with no transaction of its
// own to hand in.
//
// No permission checks here. The router asserts `ledgerView`.

import { database as db } from '@auxx/database'
import type { DocumentProps } from '@react-pdf/renderer'
import { renderToBuffer } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import { createElement } from 'react'
import { resolveDocumentSettings } from '../../../documents/resolve-settings'
import { createAssetWithVersion } from '../../../files/assets/asset-mutations'
import { getAssetContent } from '../../../files/assets/content'
import { defaultDatabase } from '../../../files/default-database'
import { createS3StoragePort } from '../../../files/storage/ports'
import { createStorageManager } from '../../../files/storage/storage-manager'
import {
  balanceSheetColumns,
  TRIAL_BALANCE_COLUMNS,
  toBalanceSheetRows,
  toProfitAndLossRows,
  toTrialBalanceRows,
} from '../adapters'
import { AGING_COLUMNS, readAging, toAgingRows } from '../aging'
import { readBalanceSheet } from '../balance-sheet'
import { readCompleteness } from '../completeness'
import { readProfitAndLoss } from '../profit-and-loss'
import type { StatementColumn, StatementRow } from '../rows'
import { readTrialBalance } from '../trial-balance'
import { readVendor1099Summary, toVendor1099Rows, VENDOR_1099_COLUMNS } from '../vendor-1099'
import { StatementPdfDocument } from './statement-document'

/** A preview render lives a day - long enough to open and download, short enough not to pile up. */
const PREVIEW_ASSET_TTL_MS = 24 * 60 * 60 * 1000

export type StatementKind =
  | 'trial-balance'
  | 'balance-sheet'
  | 'profit-and-loss'
  | 'ar-aging'
  | 'ap-aging'
  | 'vendor-1099'

/** One kind's own parameter shape - each report's own `from`/`to`/`asOf`/`compare`. */
export interface RenderStatementPdfParamsByKind {
  'trial-balance': { from?: string; to: string }
  'balance-sheet': { asOf: string; compareAsOf?: string }
  'profit-and-loss': { from: string; to: string; compare?: { from: string; to: string } }
  'ar-aging': { asOf: string }
  'ap-aging': { asOf: string }
  'vendor-1099': { year: number }
}

export interface RenderStatementPdfOptions<K extends StatementKind = StatementKind> {
  organizationId: string
  actorId: string
  kind: K
  params: RenderStatementPdfParamsByKind[K]
}

export interface RenderStatementPdfResult {
  assetId: string
  fileName: string
}

const STATEMENT_NAMES: Record<StatementKind, string> = {
  'trial-balance': 'Trial Balance',
  'balance-sheet': 'Balance Sheet',
  'profit-and-loss': 'Profit and Loss',
  'ar-aging': 'A/R Aging',
  'ap-aging': 'A/P Aging',
  'vendor-1099': '1099 Summary',
}

interface StatementPayload {
  rangeLabel: string
  /** The date this render's key and filename are stamped with. */
  asOfForKey: string
  columns: StatementColumn[]
  rows: StatementRow[]
  completenessAsOf: string
}

async function buildPayload<K extends StatementKind>(
  organizationId: string,
  kind: K,
  params: RenderStatementPdfParamsByKind[K]
): Promise<StatementPayload> {
  if (kind === 'trial-balance') {
    const { from, to } = params as RenderStatementPdfParamsByKind['trial-balance']
    const result = await readTrialBalance(db, { organizationId, from, to })
    if (result.isErr()) throw result.error
    return {
      rangeLabel: from ? `${from} to ${to}` : `As of ${to}`,
      asOfForKey: to,
      columns: TRIAL_BALANCE_COLUMNS,
      rows: toTrialBalanceRows(result.value),
      completenessAsOf: to,
    }
  }

  if (kind === 'balance-sheet') {
    const { asOf, compareAsOf } = params as RenderStatementPdfParamsByKind['balance-sheet']
    const result = await readBalanceSheet(db, { organizationId, asOf, compareAsOf })
    if (result.isErr()) throw result.error
    return {
      rangeLabel: compareAsOf ? `As of ${asOf}, compared to ${compareAsOf}` : `As of ${asOf}`,
      asOfForKey: asOf,
      columns: balanceSheetColumns(result.value),
      rows: toBalanceSheetRows(result.value, result.value.compare),
      completenessAsOf: asOf,
    }
  }

  if (kind === 'profit-and-loss') {
    const { from, to, compare } = params as RenderStatementPdfParamsByKind['profit-and-loss']
    const result = await readProfitAndLoss(db, { organizationId, from, to, compare })
    if (result.isErr()) throw result.error
    return {
      rangeLabel: `${from} to ${to}`,
      asOfForKey: to,
      columns: compare
        ? [
            { key: 'primary', label: `${from} to ${to}`, align: 'right', signed: true },
            {
              key: 'compare',
              label: `${compare.from} to ${compare.to}`,
              align: 'right',
              signed: true,
            },
          ]
        : [{ key: 'primary', label: `${from} to ${to}`, align: 'right', signed: true }],
      rows: toProfitAndLossRows(result.value, result.value.compare),
      completenessAsOf: to,
    }
  }

  if (kind === 'ar-aging' || kind === 'ap-aging') {
    const { asOf } = params as RenderStatementPdfParamsByKind['ar-aging']
    const side = kind === 'ar-aging' ? 'receivable' : 'payable'
    const result = await readAging(db, { organizationId, side, asOf })
    if (result.isErr()) throw result.error
    return {
      rangeLabel: `As of ${asOf}`,
      asOfForKey: asOf,
      columns: AGING_COLUMNS,
      rows: toAgingRows(result.value),
      completenessAsOf: asOf,
    }
  }

  // 'vendor-1099'. Not a GL read (`vendor-1099.ts`'s own header) - there is
  // no `asOf` to bound completeness by, so this uses the last day of the
  // filing year, the closest calendar meaning "as of" has for a year-shaped report.
  const { year } = params as RenderStatementPdfParamsByKind['vendor-1099']
  const asOfForCompleteness = `${String(year).padStart(4, '0')}-12-31`
  const result = await readVendor1099Summary(db, { organizationId, year })
  if (result.isErr()) throw result.error
  return {
    rangeLabel: `Year ${year}`,
    asOfForKey: String(year),
    columns: VENDOR_1099_COLUMNS,
    rows: toVendor1099Rows(result.value),
    completenessAsOf: asOfForCompleteness,
  }
}

/**
 * Render one financial statement to a PDF and store it as a short-lived
 * `MediaAsset`, exactly `preview-pdf.ts`'s pattern. The `StatementRow[]`
 * payload is computed by the SAME lib reads the screen calls, through the
 * SAME adapters, so the PDF can never disagree with the page.
 */
export async function renderStatementPdf<K extends StatementKind>(
  options: RenderStatementPdfOptions<K>
): Promise<RenderStatementPdfResult> {
  const { organizationId, actorId, kind, params } = options

  const [settings, payload] = await Promise.all([
    resolveDocumentSettings(organizationId),
    buildPayload(organizationId, kind, params),
  ])

  const completeness = await readCompleteness(db, {
    organizationId,
    asOf: payload.completenessAsOf,
  })
  if (completeness.isErr()) throw completeness.error

  let logoBytes: Buffer | null = null
  const logoAssetId = settings.branding.logo?.assetId
  if (logoAssetId) {
    const logo = await getAssetContent(
      { db: defaultDatabase(), organizationId },
      { storage: createS3StoragePort(organizationId) },
      logoAssetId
    )
    logoBytes = logo.isOk() ? logo.value : null
  }

  const orgName = settings.business.companyName || 'Statement'
  const runDateLabel = new Date().toISOString().slice(0, 10)

  const element = createElement(StatementPdfDocument, {
    settings,
    logoBytes,
    orgName,
    statementName: STATEMENT_NAMES[kind],
    rangeLabel: payload.rangeLabel,
    runDateLabel,
    columns: payload.columns,
    rows: payload.rows,
    completeness: completeness.value.items,
  })
  // Same type shim `documents/render.ts` carries: `renderToBuffer` types its
  // argument as `ReactElement<DocumentProps>` (the root `<Document>`), but
  // `StatementPdfDocument` is a COMPONENT that returns one - react-pdf's
  // reconciler resolves that like any host tree, the surface types just don't
  // model it.
  const buffer = await renderToBuffer(element as unknown as ReactElement<DocumentProps>)

  const timestamp = Date.now()
  const fileName = `${kind}-${payload.asOfForKey}.pdf`
  const storageManager = createStorageManager(organizationId)
  const storageKey = `reports/${organizationId}/${kind}/${payload.asOfForKey}-${timestamp}.pdf`
  const storageLocation = await storageManager.uploadContent({
    provider: 'S3',
    key: storageKey,
    content: buffer,
    mimeType: 'application/pdf',
    size: buffer.length,
    visibility: 'PRIVATE',
    organizationId,
  })

  const assetId = await db.transaction(async (tx) => {
    const created = await createAssetWithVersion(
      tx,
      { db: tx, organizationId },
      { now: () => new Date() },
      {
        kind: 'DOCUMENT',
        purpose: 'PREVIEW',
        name: fileName,
        mimeType: 'application/pdf',
        size: buffer.length,
        isPrivate: true,
        createdById: actorId,
        expiresAt: new Date(Date.now() + PREVIEW_ASSET_TTL_MS),
        storageLocationId: storageLocation.id,
      }
    )
    if (created.isErr()) throw created.error
    return created.value.asset.id
  })

  return { assetId, fileName }
}
