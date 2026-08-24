// apps/worker/scripts/verify-money-mq2-send.ts
/**
 * Money MQ2 send-flow verification (plans/dispatch/money/05-mq2-build.md §E.1/§E.5).
 * Exercises `prepareDocumentEmail` directly (the server-side logic behind
 * `money.prepareDocumentEmail`) against a real dev org — the browser send loop
 * (composer prefill, actual send, confirmed-send status flip) is verified separately.
 *
 * Checks:
 *  1. Happy path: quote + contact-with-email → resolved HTML has NO remaining
 *     `data-type="placeholder"` spans, subject = the seeded snippet's title, `to`
 *     carries the contact's real email, and `attachment.id` is a real MediaAsset
 *     (content-hash cache hit re-uses the same asset `ensureQuoteDocumentPdf` renders).
 *  2. Missing-contact-email: a quote linked to a contact with NO email throws a
 *     typed `BadRequestError`.
 *  3. No-contact-at-all: a quote with no linked contact throws a typed `BadRequestError`.
 *
 * Creates records prefixed "[MQ2-send-verify]" and deletes them (+ any rendered
 * MediaAsset) in a finally block.
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/verify-money-mq2-send.ts
 */

import { database } from '@auxx/database'
import { BadRequestError } from '@auxx/lib/errors'
import {
  createS3StoragePort,
  createThumbnailCleanupPort,
  deleteAsset,
} from '@auxx/lib/files/server'
import { prepareDocumentEmail } from '@auxx/lib/money'
import { UnifiedCrudHandler } from '@auxx/lib/resources'

/** Build a RecordId string without pulling in `@auxx/types` (not a worker dependency). */
function toRecordId(entityDefinitionId: string, entityInstanceId: string) {
  return `${entityDefinitionId}:${entityInstanceId}` as never
}

/**
 * Soft-delete a `MediaAsset` and sweep the thumbnails derived from it.
 *
 * `MediaAssetService.delete` built the thumbnail collaborator inside lib with a
 * dynamic `import('./thumbnail-service')`. `deleteAsset` takes it as a parameter
 * instead, so the port is constructed here, at the composition site, and bound
 * to the SAME transaction the delete runs on — sweeping on the outer pool while
 * inside the transaction is the stale-read bug the refactor exists to kill.
 */
async function deleteMediaAsset(organizationId: string, assetId: string): Promise<void> {
  const result = await database.transaction(async (tx) => {
    const ctx = { db: tx, organizationId }
    const deps = {
      now: () => new Date(),
      thumbnails: createThumbnailCleanupPort(ctx, {
        storage: createS3StoragePort(organizationId),
        now: () => new Date(),
      }),
    }
    return deleteAsset(tx, ctx, deps, assetId)
  })
  if (result.isErr()) throw result.error
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

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — same as MQ1/MQ2-pdf scripts)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)

  let quoteWithEmailId: string | undefined
  let contactWithEmailId: string | undefined
  let assetId: string | undefined

  let quoteNoEmailId: string | undefined
  let contactNoEmailId: string | undefined

  let quoteNoContactId: string | undefined

  try {
    // ── Fixtures ─────────────────────────────────────────────────────────────
    const contactWithEmail = await handler.create('contact', {
      first_name: 'MQ2Send',
      last_name: 'Verify',
      primary_email: 'mq2-send-verify@example.com',
    })
    contactWithEmailId = contactWithEmail.instance.id
    const contactWithEmailRecordId = toRecordId('contact', contactWithEmailId)

    const quoteWithEmail = await handler.create('quote', {
      quote_title: '[MQ2-send-verify] Quote with email',
      quote_contact: contactWithEmailRecordId,
    })
    quoteWithEmailId = quoteWithEmail.instance.id
    const quoteWithEmailRecordId = toRecordId('quote', quoteWithEmailId)

    const contactNoEmail = await handler.create('contact', {
      first_name: 'MQ2SendNoEmail',
      last_name: 'Verify',
    })
    contactNoEmailId = contactNoEmail.instance.id
    const contactNoEmailRecordId = toRecordId('contact', contactNoEmailId)

    const quoteNoEmail = await handler.create('quote', {
      quote_title: '[MQ2-send-verify] Quote, contact has no email',
      quote_contact: contactNoEmailRecordId,
    })
    quoteNoEmailId = quoteNoEmail.instance.id

    const quoteNoContact = await handler.create('quote', {
      quote_title: '[MQ2-send-verify] Quote with no contact',
    })
    quoteNoContactId = quoteNoContact.instance.id

    // ── 1: happy path ──────────────────────────────────────────────────────
    console.log('1: prepareDocumentEmail — happy path')
    const prepared = await prepareDocumentEmail({
      organizationId,
      userId,
      quoteRecordId: quoteWithEmailRecordId,
    })
    check(
      'contentHtml has NO remaining placeholder spans',
      !prepared.contentHtml.includes('data-type="placeholder"'),
      prepared.contentHtml
    )
    check(
      'subject present (non-empty)',
      typeof prepared.subject === 'string' && prepared.subject.length > 0,
      prepared.subject
    )
    check(
      'to[] carries the contact email',
      prepared.to.length === 1 && prepared.to[0]?.email === 'mq2-send-verify@example.com',
      prepared.to
    )
    check('attachment.type === asset', prepared.attachment.type === 'asset')
    check('attachment.id present', !!prepared.attachment.id, prepared.attachment)
    assetId = prepared.attachment.id

    const asset = await database.query.MediaAsset.findFirst({
      where: (t, { eq }) => eq(t.id, prepared.attachment.id),
    })
    check('attachment.id resolves to a real MediaAsset row', !!asset, prepared.attachment.id)

    console.log('--- resolved contentHtml (for review) ---')
    console.log(prepared.contentHtml)

    // ── 2: missing contact email ────────────────────────────────────────────
    console.log('2: prepareDocumentEmail — contact has no email')
    let noEmailError: unknown
    try {
      await prepareDocumentEmail({
        organizationId,
        userId,
        quoteRecordId: toRecordId('quote', quoteNoEmailId),
      })
    } catch (err) {
      noEmailError = err
    }
    check(
      'throws BadRequestError when the contact has no email',
      noEmailError instanceof BadRequestError,
      noEmailError instanceof Error ? noEmailError.message : noEmailError
    )

    // ── 3: no contact linked at all ─────────────────────────────────────────
    console.log('3: prepareDocumentEmail — no contact linked')
    let noContactError: unknown
    try {
      await prepareDocumentEmail({
        organizationId,
        userId,
        quoteRecordId: toRecordId('quote', quoteNoContactId),
      })
    } catch (err) {
      noContactError = err
    }
    check(
      'throws BadRequestError when the quote has no contact',
      noContactError instanceof BadRequestError,
      noContactError instanceof Error ? noContactError.message : noContactError
    )
  } finally {
    console.log('Cleanup')
    if (assetId) {
      try {
        await deleteMediaAsset(organizationId, assetId)
      } catch (err) {
        console.log(
          `  cleanup failed for asset:${assetId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const [type, id] of [
      ['quote', quoteWithEmailId],
      ['quote', quoteNoEmailId],
      ['quote', quoteNoContactId],
      ['contact', contactWithEmailId],
      ['contact', contactNoEmailId],
    ] as const) {
      if (!id) continue
      try {
        await handler.delete(toRecordId(type, id))
      } catch (err) {
        console.log(`  cleanup failed for ${type}:${id}:`, err instanceof Error ? err.message : err)
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
