// packages/lib/src/postings/__tests__/document-effect-types.test.ts
//
// The D19 document effect contract (53 §7.3.3). One shared contract stands in
// for six bespoke ones, so its refusals carry six families' worth of weight and
// are worth asserting directly rather than only through a posting path.

import { describe, expect, it } from 'vitest'
import {
  acceptedDocumentEffectBasisSchema,
  DOCUMENT_EFFECT_FAMILIES,
  DOCUMENT_EFFECT_FAMILY_SPEC,
  documentAccountingBasisSchema,
  documentRoleScope,
  documentWorkBasisSchema,
  isDocumentEffectFamily,
} from '../document-effect-types'
import { accountingBasisHash } from '../effect-basis'
import { POSTING_TYPES } from '../types'

const HASH = 'a'.repeat(64)

const documentLine = (over: Record<string, unknown> = {}) => ({
  lineKey: 'line:0',
  accountRole: 'accounts_receivable',
  glAccountId: null,
  direction: 'debit',
  amountMinor: '1000',
  counterpartyType: null,
  counterpartyId: null,
  dimensions: {},
  ...over,
})

const calculation = (over: Record<string, unknown> = {}) => ({
  version: 1,
  family: 'invoice_issued',
  documentInstanceId: 'inv_1',
  documentKey: 'INV-0001',
  sourceHash: HASH,
  effectiveDate: '2026-09-01',
  currency: 'USD',
  currencyExponent: 2,
  totalMinor: '1000',
  lines: [
    documentLine(),
    documentLine({
      lineKey: 'line:1',
      accountRole: 'revenue_service',
      direction: 'credit',
    }),
  ],
  ...over,
})

const accepted = (over: Record<string, unknown> = {}) => ({
  version: 1,
  sourceBasisVersion: 1,
  sourceHash: HASH,
  policyKey: 'document_entry_v1',
  policyVersion: 1,
  effectiveDate: '2026-09-01',
  bookTimeZone: 'UTC',
  currency: 'USD',
  currencyExponent: 2,
  documentRefs: [{ resourceKind: 'invoice', entityInstanceId: 'inv_1' }],
  calculation: calculation(),
  accountResolution: [
    {
      lineKey: 'line:0',
      glAccountId: 'gl_ar',
      accountRole: 'accounts_receivable' as string | null,
      selectedBy: 'org_role' as string,
      configurationHash: HASH,
    },
    {
      lineKey: 'line:1',
      glAccountId: 'gl_rev',
      accountRole: 'revenue_service' as string | null,
      selectedBy: 'org_role' as string,
      configurationHash: HASH,
    },
  ],
  contribution: [
    {
      lineKey: 'line:0',
      glAccountId: 'gl_ar',
      direction: 'debit',
      amountMinor: '1000',
      counterpartyType: null,
      counterpartyId: null,
      dimensions: {},
    },
    {
      lineKey: 'line:1',
      glAccountId: 'gl_rev',
      direction: 'credit',
      amountMinor: '1000',
      counterpartyType: null,
      counterpartyId: null,
      dimensions: {},
    },
  ],
  ...over,
})

describe('the family registry', () => {
  it('names a real posting type for every family', () => {
    for (const family of DOCUMENT_EFFECT_FAMILIES) {
      expect(POSTING_TYPES).toContain(DOCUMENT_EFFECT_FAMILY_SPEC[family].postingType)
    }
  })

  // 🛑 Two families may share an owner (an invoice is issued AND written off),
  // which is only safe because the effect kind is part of the partial unique on
  // (organizationId, entityInstanceId, effectKind).
  it('keeps the six families distinct while letting two share an owner', () => {
    expect(new Set(DOCUMENT_EFFECT_FAMILIES).size).toBe(6)
    expect(DOCUMENT_EFFECT_FAMILY_SPEC.invoice_issued.entityType).toBe(
      DOCUMENT_EFFECT_FAMILY_SPEC.invoice_write_off.entityType
    )
    expect(DOCUMENT_EFFECT_FAMILY_SPEC.invoice_issued.postingType).not.toBe(
      DOCUMENT_EFFECT_FAMILY_SPEC.invoice_write_off.postingType
    )
  })

  it('does not claim the families D19 left alone', () => {
    for (const kind of ['manual_journal', 'provider_sync', 'bank_deposit', 'build', 'fulfillment'])
      expect(isDocumentEffectFamily(kind)).toBe(false)
  })
})

describe('the document calculation', () => {
  it('accepts a balanced two-line document', () => {
    expect(documentAccountingBasisSchema.safeParse(calculation()).success).toBe(true)
  })

  it('refuses lines that do not balance', () => {
    const parsed = documentAccountingBasisSchema.safeParse(
      calculation({
        lines: [
          documentLine(),
          documentLine({ lineKey: 'line:1', direction: 'credit', amountMinor: '900' }),
        ],
      })
    )
    expect(parsed.success).toBe(false)
  })

  it('refuses a total that disagrees with the debit side', () => {
    const parsed = documentAccountingBasisSchema.safeParse(calculation({ totalMinor: '900' }))
    expect(parsed.success).toBe(false)
  })

  it('refuses a line that names both a role and an account, or neither', () => {
    for (const line of [
      documentLine({ glAccountId: 'gl_ar' }),
      documentLine({ accountRole: null }),
    ]) {
      const parsed = documentAccountingBasisSchema.safeParse(
        calculation({
          lines: [line, documentLine({ lineKey: 'line:1', direction: 'credit' })],
        })
      )
      expect(parsed.success).toBe(false)
    }
  })

  it('refuses duplicate line keys', () => {
    const parsed = documentAccountingBasisSchema.safeParse(
      calculation({ lines: [documentLine(), documentLine({ direction: 'credit' })] })
    )
    expect(parsed.success).toBe(false)
  })
})

describe('the work basis', () => {
  it('pins the owner, family, hash and date to the calculation', () => {
    const ready = {
      version: 1,
      status: 'ready',
      family: 'invoice_issued',
      documentInstanceId: 'inv_1',
      sourceHash: HASH,
      effectiveDate: '2026-09-01',
      calculation: calculation(),
    }
    expect(documentWorkBasisSchema.safeParse(ready).success).toBe(true)
    for (const drift of [
      { documentInstanceId: 'inv_2' },
      { family: 'invoice_write_off' },
      { effectiveDate: '2026-09-02' },
    ])
      expect(documentWorkBasisSchema.safeParse({ ...ready, ...drift }).success).toBe(false)
  })

  it('allows durable incomplete evidence', () => {
    const parsed = documentWorkBasisSchema.safeParse({
      version: 1,
      status: 'incomplete',
      family: 'payout_settlement',
      documentInstanceId: 'po_1',
      sourceHash: HASH,
      effectiveDate: null,
      missingDependencies: ['bank_account_gl_account'],
      observed: {},
    })
    expect(parsed.success).toBe(true)
  })
})

describe('the accepted effect basis', () => {
  it('accepts a resolved, balanced contribution', () => {
    expect(acceptedDocumentEffectBasisSchema.safeParse(accepted()).success).toBe(true)
  })

  // 🔑 The load-bearing check: the contribution IS the document's lines with
  // their accounts resolved. Anything else is an entry that does not tie to the
  // document it names.
  it('refuses a contribution that drifts from the document line it names', () => {
    const drifted = accepted()
    drifted.contribution[0]!.amountMinor = '900'
    drifted.contribution[1]!.amountMinor = '900'
    drifted.calculation = calculation({ totalMinor: '1000' })
    expect(acceptedDocumentEffectBasisSchema.safeParse(drifted).success).toBe(false)
  })

  it('refuses a contribution line the document does not have', () => {
    const extra = accepted()
    extra.contribution[1]!.lineKey = 'line:9'
    extra.accountResolution[1]!.lineKey = 'line:9'
    expect(acceptedDocumentEffectBasisSchema.safeParse(extra).success).toBe(false)
  })

  it('refuses a line that left the account role its document named', () => {
    const repointed = accepted()
    repointed.accountResolution[1]!.accountRole = 'revenue_product'
    expect(acceptedDocumentEffectBasisSchema.safeParse(repointed).success).toBe(false)
  })

  it('refuses a line that left the account id its document named', () => {
    const idRouted = accepted({
      calculation: calculation({
        lines: [
          documentLine(),
          documentLine({
            lineKey: 'line:1',
            accountRole: null,
            glAccountId: 'gl_named',
            direction: 'credit',
          }),
        ],
      }),
    })
    idRouted.accountResolution[1] = {
      lineKey: 'line:1',
      glAccountId: 'gl_rev',
      accountRole: null,
      selectedBy: 'document',
      configurationHash: HASH,
    }
    expect(acceptedDocumentEffectBasisSchema.safeParse(idRouted).success).toBe(false)
  })

  it('refuses a missing document reference for the family resource kind', () => {
    const parsed = acceptedDocumentEffectBasisSchema.safeParse(
      accepted({ documentRefs: [{ resourceKind: 'order', entityInstanceId: 'inv_1' }] })
    )
    expect(parsed.success).toBe(false)
  })

  // D13. Absent everywhere today, and absence must serialize to what it always
  // did so no frozen `basisHash` has to be recomputed when the cash book lands.
  it('reserves the basis discriminator without changing the canonical hash', () => {
    const without = acceptedDocumentEffectBasisSchema.parse(accepted())
    expect(without.basis).toBeUndefined()
    const withBasis = acceptedDocumentEffectBasisSchema.parse(accepted({ basis: 'cash' }))
    expect(withBasis.basis).toBe('cash')
    expect(accountingBasisHash(without)).not.toBe(accountingBasisHash(withBasis))
    expect(accountingBasisHash(without)).toBe(accountingBasisHash(accepted()))
  })
})

describe('documentRoleScope', () => {
  // 🛑 Byte-for-byte what `accept-entry.ts`'s `effectRoleScope` derives, or a
  // scoped org gets a refusal describing a change nobody made.
  it('distinguishes absent from null from a named source', () => {
    expect(documentRoleScope({})).toEqual({})
    expect(documentRoleScope({ sourceStoreId: null })).toEqual({ store: null })
    expect(documentRoleScope({ sourceStoreId: 'src_1' })).toEqual({ store: 'src_1' })
    expect(documentRoleScope({ processorAccountId: 'pa_1' })).toEqual({ processor: 'pa_1' })
  })
})
