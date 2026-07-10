// apps/worker/scripts/verify-money-mq2-pdf.ts
/**
 * Money MQ2 PDF render pipeline smoke test (plans/dispatch/money/05-mq2-build.md §A.4/§B/§C
 * — settings resolution, payload building, react-pdf rendering, render-or-reuse MediaAsset
 * caching). Companion to `verify-money-mq1.ts` — covers ONLY the PDF slice; §D–G (system
 * snippets, send flow, Documents settings UI, Expired badge) are separate MQ2 work.
 *
 * Checks:
 *  1. `renderDocumentPdf(SAMPLE_QUOTE_PDF_PAYLOAD)` produces a real PDF (magic bytes + size).
 *  2. `ensureQuotePdf` against a real quote creates a `MediaAsset` + writes `pdfAsset`.
 *  3. A second call with unchanged data is a content-hash cache hit — no new version.
 *  4. Editing a line item's price changes the hash — a new version is created.
 *
 * Creates records prefixed "[MQ2-pdf-verify]" and deletes them (+ the rendered MediaAsset)
 * in a finally block.
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/verify-money-mq2-pdf.ts
 */

import { database } from '@auxx/database'
import { ensureQuotePdf, renderDocumentPdf, SAMPLE_QUOTE_PDF_PAYLOAD } from '@auxx/lib/documents'
import { MediaAssetService } from '@auxx/lib/files'
import { UnifiedCrudHandler } from '@auxx/lib/resources'

/** Build a RecordId string without pulling in `@auxx/types` (not a worker dependency). */
function toRecordId(entityDefinitionId: string, entityInstanceId: string) {
  return `${entityDefinitionId}:${entityInstanceId}` as never
}

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`, detail ?? '')
  }
}

async function entityDefId(organizationId: string, entityType: string) {
  const def = await database.query.EntityDefinition.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.entityType, entityType)),
  })
  return def?.id ?? null
}

async function fieldId(organizationId: string, entityType: string, systemAttribute: string) {
  const defId = await entityDefId(organizationId, entityType)
  if (!defId) return null
  const field = await database.query.CustomField.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.entityDefinitionId, defId), eq(t.systemAttribute, systemAttribute)),
  })
  return field?.id ?? null
}

async function fieldValueByAttr(
  organizationId: string,
  entityType: string,
  instanceId: string,
  systemAttribute: string
) {
  const fid = await fieldId(organizationId, entityType, systemAttribute)
  if (!fid) return null
  const fv = await database.query.FieldValue.findFirst({
    where: (t, { and, eq }) => and(eq(t.entityId, instanceId), eq(t.fieldId, fid)),
  })
  return fv ?? null
}

async function versionCount(assetId: string): Promise<number> {
  const rows = await database.query.MediaAssetVersion.findMany({
    where: (t, { eq }) => eq(t.assetId, assetId),
    columns: { id: true },
  })
  return rows.length
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — same as M1 script)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)

  // ── 1: Render the hardcoded SAMPLE payload standalone (no DB) ────────────────
  console.log('1: renderDocumentPdf(SAMPLE_QUOTE_PDF_PAYLOAD)')
  const sampleBuffer = await renderDocumentPdf(SAMPLE_QUOTE_PDF_PAYLOAD)
  const magic = sampleBuffer.subarray(0, 5).toString('latin1')
  check('sample PDF starts with %PDF magic bytes', magic === '%PDF-', magic)
  check(
    `sample PDF size > 5KB (${(sampleBuffer.length / 1024).toFixed(1)}KB)`,
    sampleBuffer.length > 5 * 1024
  )

  let quoteInstanceId: string | undefined
  let lineInstanceId: string | undefined
  let assetId: string | undefined

  try {
    // ── 2: ensureQuotePdf against a real quote ──────────────────────────────────
    console.log('2: ensureQuotePdf — first render')
    const contactDefId = await entityDefId(organizationId, 'contact')
    const contact = contactDefId
      ? await database.query.EntityInstance.findFirst({
          columns: { id: true },
          where: (t, { eq }) => eq(t.entityDefinitionId, contactDefId),
        })
      : null
    if (!contact) throw new Error('No contact in org — cannot test quote PDF rendering')
    const contactRecordId = toRecordId('contact', contact.id)

    const quote = await handler.create('quote', {
      quote_title: '[MQ2-pdf-verify] Quote',
      quote_contact: contactRecordId,
      quote_terms: 'Net 30. Prices valid for 30 days.',
      quote_tax_rate: 8.25,
      quote_discount_type: 'percent',
      quote_discount_value: 10,
    })
    quoteInstanceId = quote.instance.id
    const quoteRecordId = toRecordId('quote', quoteInstanceId)

    const line = await handler.create('line_item', {
      line_item_name: '[MQ2-pdf-verify] Line',
      line_item_qty: 2,
      line_item_unit_price: 5000,
      line_item_taxable: true,
      line_item_quote: quoteRecordId,
    })
    lineInstanceId = line.instance.id

    const first = await ensureQuotePdf({ organizationId, quoteRecordId, actorId: userId })
    assetId = first.assetId
    check('first ensureQuotePdf call rendered (rendered:true)', first.rendered === true)
    check('assetId returned', !!first.assetId, first)

    const asset = await database.query.MediaAsset.findFirst({
      where: (t, { eq }) => eq(t.id, first.assetId),
    })
    check('MediaAsset row created', !!asset, first.assetId)
    check(`MediaAsset named ${first.fileName}`, asset?.name === first.fileName, asset?.name)

    const pdfAssetField = await fieldValueByAttr(
      organizationId,
      'quote',
      quoteInstanceId,
      'quote_pdf_asset'
    )
    check(
      'quote.pdfAsset field written to the new asset id',
      pdfAssetField?.valueText === first.assetId,
      pdfAssetField?.valueText
    )

    const versionsAfterFirst = await versionCount(first.assetId)
    check(
      'exactly one MediaAssetVersion after first render',
      versionsAfterFirst === 1,
      versionsAfterFirst
    )

    // ── 3: second call, unchanged data — cache hit ──────────────────────────────
    console.log('3: ensureQuotePdf — cache hit')
    const second = await ensureQuotePdf({ organizationId, quoteRecordId, actorId: userId })
    check('second call is a cache hit (rendered:false)', second.rendered === false, second)
    check('cache hit returns the same assetId', second.assetId === first.assetId)
    const versionsAfterSecond = await versionCount(first.assetId)
    check(
      'no new version created on cache hit',
      versionsAfterSecond === versionsAfterFirst,
      versionsAfterSecond
    )

    // ── 4: change a line item price — new version ───────────────────────────────
    console.log('4: ensureQuotePdf — content change')
    await handler.update(toRecordId('line_item', lineInstanceId), { line_item_unit_price: 7500 })
    const third = await ensureQuotePdf({ organizationId, quoteRecordId, actorId: userId })
    check('price change triggers a re-render (rendered:true)', third.rendered === true, third)
    check('same asset reused (one asset per quote)', third.assetId === first.assetId)
    const versionsAfterThird = await versionCount(first.assetId)
    check(
      'a new version was created after the content change',
      versionsAfterThird === versionsAfterFirst + 1,
      versionsAfterThird
    )
  } finally {
    console.log('Cleanup')
    if (assetId) {
      try {
        const mediaAssetService = new MediaAssetService(organizationId, userId)
        await mediaAssetService.delete(assetId)
      } catch (err) {
        console.log(
          `  cleanup failed for asset:${assetId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    if (lineInstanceId) {
      try {
        await handler.delete(toRecordId('line_item', lineInstanceId))
      } catch (err) {
        console.log(
          `  cleanup failed for line_item:${lineInstanceId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    if (quoteInstanceId) {
      try {
        await handler.delete(toRecordId('quote', quoteInstanceId))
      } catch (err) {
        console.log(
          `  cleanup failed for quote:${quoteInstanceId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
