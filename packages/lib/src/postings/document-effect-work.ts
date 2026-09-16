// packages/lib/src/postings/document-effect-work.ts

import { schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../errors'
import { withAccountingCommitLock } from './accounting-commit-lock'
import {
  DOCUMENT_EFFECT_FAMILY_SPEC,
  type DocumentEffectFamily,
  type DocumentWorkBasisInput,
  documentWorkBasisSchema,
} from './document-effect-types'
import { accountingBasisHash } from './effect-basis'

/**
 * Stable original identity for one document-driven accounting obligation.
 *
 * Deliberately excludes the date, the amounts and the input hash, exactly as
 * `fulfillmentAccountingEffectKey` does: an invoice re-dated before it posts is
 * the SAME obligation with a new basis version, not a second one.
 *
 * ## 🔑 `occurrence` is what a repeatable family adds, and only a repeatable one
 *
 * A 1:1 family leaves it at `'original'` — byte for byte the key it has always
 * minted. A `repeatable` family (see `DOCUMENT_EFFECT_FAMILY_SPEC`) passes the
 * occurrence its journal is keyed on, so the second write-off of one invoice is
 * a second ORIGINAL obligation with its own key rather than a collision on
 * `AccountingWork_org_effect_key`.
 *
 * 🛑 The two halves are enforced against each other: a 1:1 family that passes an
 * occurrence is a caller error, because it would silently mint a second original
 * for an owner the narrowed partial unique still guarantees one of.
 */
export function documentAccountingEffectKey(
  family: DocumentEffectFamily,
  documentInstanceId: string,
  occurrence = 'original'
): string {
  if (!documentInstanceId) throw new UnprocessableEntityError('A document ID is required')
  if (!occurrence) throw new UnprocessableEntityError('A document occurrence key cannot be blank')
  if (occurrence !== 'original' && !DOCUMENT_EFFECT_FAMILY_SPEC[family].repeatable)
    throw new UnprocessableEntityError(
      `${family} is one accounting obligation per document, so it cannot name an occurrence`
    )
  return `${family}:` + JSON.stringify([documentInstanceId, occurrence])
}

/**
 * Refuse when this document already has a journal that no effect owns.
 *
 * Every D19 family posted straight through `postEntry` before this contract
 * existed, claiming `(organizationId, postingType, documentKey, 0)` with a
 * `draft` that carries no `accountingMembership`. Re-posting such a document
 * through acceptance would collide on that exact claim, and `acceptEntryInTx`
 * would report it as "the existing journal has no provable accounting
 * membership" — true, but a sentence that names nothing an operator can act on.
 *
 * 🛑 Scoped to the claim, not to the source. A journal this document's OWN
 * effect already owns is the ordinary converged re-run and must pass straight
 * through; only an unowned one is the collision.
 */
export async function assertDocumentJournalIsOwnedInTx(
  tx: Transaction,
  input: { organizationId: string; family: DocumentEffectFamily; documentKey: string }
) {
  const { postingType, resourceKind } = DOCUMENT_EFFECT_FAMILY_SPEC[input.family]
  const [journal] = await tx
    .select({ id: schema.GlPosting.id, draft: schema.GlPosting.draft })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, input.organizationId),
        eq(schema.GlPosting.postingType, postingType),
        eq(schema.GlPosting.periodKey, input.documentKey)
      )
    )
    .limit(1)
  if (!journal) return
  const draft = journal.draft
  if (draft !== null && typeof draft === 'object' && 'accountingMembership' in draft) return
  throw new ConflictError(
    `This ${resourceKind} already has journal ${journal.id}, which predates accounting effects. ` +
      'Reverse or reconcile it before posting this document again.'
  )
}

/** Create inputs carry evidence; the original identity comes from the document. */
export interface CaptureDocumentWorkInput {
  organizationId: string
  family: DocumentEffectFamily
  documentInstanceId: string
  eligibility: 'automatic' | 'manual' | 'excluded'
  basis: DocumentWorkBasisInput
  /**
   * Which occurrence of a `repeatable` family this is — the write-off's attempt,
   * say. Omitted on every 1:1 family, which is all of them but one.
   *
   * @see documentAccountingEffectKey
   */
  occurrence?: string
}

async function assertDocument(
  tx: Transaction,
  organizationId: string,
  family: DocumentEffectFamily,
  documentInstanceId: string
) {
  const { entityType } = DOCUMENT_EFFECT_FAMILY_SPEC[family]
  const [source] = await tx
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      and(
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId),
        eq(schema.EntityDefinition.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.id, documentInstanceId),
        eq(schema.EntityDefinition.entityType, entityType),
        isNull(schema.EntityInstance.archivedAt),
        isNull(schema.EntityDefinition.archivedAt)
      )
    )
    .limit(1)
  if (!source)
    throw new UnprocessableEntityError(
      `Accounting work requires a live ${entityType} in this organization`
    )
}

/**
 * Capture one document's original obligation and its selected input basis.
 *
 * The caller owns the surrounding domain transaction; this only records the
 * durable obligation. The accepted journal is created later by `acceptEntryInTx`
 * under the same commit lock.
 *
 * Replay is convergent: an identical basis returns the saved row, and changed
 * evidence on a still-pending obligation appends a version rather than minting a
 * second original. An obligation that has already been ACCEPTED refuses, because
 * an accepted effect is immutable and the only way past it is a correction.
 */
export async function captureDocumentWorkInTx(tx: Transaction, input: CaptureDocumentWorkInput) {
  const basis = documentWorkBasisSchema.parse(input.basis)
  if (basis.family !== input.family)
    throw new ConflictError('Work family differs from its input basis')
  if (basis.documentInstanceId !== input.documentInstanceId)
    throw new ConflictError('Work source differs from its input basis')
  await withAccountingCommitLock(tx, input.organizationId)
  await assertDocument(tx, input.organizationId, input.family, input.documentInstanceId)

  const effectKey = documentAccountingEffectKey(
    input.family,
    input.documentInstanceId,
    input.occurrence
  )
  const existing = await tx.query.AccountingWork.findFirst({
    where: and(
      eq(schema.AccountingWork.organizationId, input.organizationId),
      eq(schema.AccountingWork.effectKey, effectKey)
    ),
  })
  if (existing) {
    const saved = await tx.query.AccountingWorkBasis.findFirst({
      where: and(
        eq(schema.AccountingWorkBasis.organizationId, input.organizationId),
        eq(schema.AccountingWorkBasis.workId, existing.id),
        eq(schema.AccountingWorkBasis.version, existing.basisVersion)
      ),
    })
    if (!saved) throw new ConflictError('The selected document accounting basis is missing')
    if (accountingBasisHash(saved.basis) === accountingBasisHash(basis))
      return { work: existing, basis: saved, existing: true }
    if (!['pending', 'blocked'].includes(existing.state))
      throw new ConflictError(
        'Accepted document work already exists with a different basis; create a correction'
      )
    const accepted = await tx.query.AccountingEffect.findFirst({
      where: and(
        eq(schema.AccountingEffect.organizationId, input.organizationId),
        eq(schema.AccountingEffect.workId, existing.id)
      ),
    })
    if (accepted) throw new ConflictError('Accepted document accounting requires a correction')
    const version = existing.basisVersion + 1
    const [nextBasis] = await tx
      .insert(schema.AccountingWorkBasis)
      .values({
        organizationId: input.organizationId,
        workId: existing.id,
        version,
        sourceHash: basis.sourceHash,
        effectiveDate: basis.effectiveDate,
        basis,
      })
      .returning()
    const [updated] = await tx
      .update(schema.AccountingWork)
      .set({
        basisVersion: version,
        state: basis.status === 'ready' ? 'pending' : 'blocked',
        blockedReason: basis.status === 'incomplete' ? basis.missingDependencies.join(', ') : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.AccountingWork.organizationId, input.organizationId),
          eq(schema.AccountingWork.id, existing.id)
        )
      )
      .returning()
    if (!nextBasis || !updated) throw new Error('Document accounting basis update returned no row')
    return { work: updated, basis: nextBasis, existing: true }
  }

  const [work] = await tx
    .insert(schema.AccountingWork)
    .values({
      organizationId: input.organizationId,
      entityInstanceId: input.documentInstanceId,
      effectKind: input.family,
      componentKey: 'original',
      effectKey,
      operation: 'original',
      basisVersion: 1,
      state: basis.status === 'ready' ? 'pending' : 'blocked',
      eligibility: input.eligibility,
      blockedReason: basis.status === 'incomplete' ? basis.missingDependencies.join(', ') : null,
    })
    .returning()
  if (!work) throw new Error('Accounting work insert returned no row')

  const [saved] = await tx
    .insert(schema.AccountingWorkBasis)
    .values({
      organizationId: input.organizationId,
      workId: work.id,
      version: 1,
      sourceHash: basis.sourceHash,
      effectiveDate: basis.effectiveDate,
      basis,
    })
    .returning()
  if (!saved) throw new Error('Accounting basis insert returned no row')
  return { work, basis: saved, existing: false }
}
