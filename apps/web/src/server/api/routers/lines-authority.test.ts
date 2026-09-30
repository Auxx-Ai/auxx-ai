// apps/web/src/server/api/routers/lines-authority.test.ts
//
// The `lines` router takes the parent document's authority (plans/entity/domain-tables
// decision 10): a ledger family needs `ledgerPost`, any other needs edit on its own def,
// and `list` needs view. Driven through `createCaller`; the lib writes are doubles.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const DEF_IDS: Record<string, string> = { invoice: 'def_invoice', quote: 'def_quote' }

const h = vi.hoisted(() => ({
  documentRows: [{ id: 'doc_1' }] as Array<{ id: string }>,
}))

const okResult = <T>(value: T) => ({ isOk: () => true as const, value })

vi.mock('@auxx/lib/accounting/documents/lines', () => ({
  readDocumentLines: vi.fn(async () => []),
  createLines: vi.fn(async () => okResult([])),
  updateLine: vi.fn(async () => okResult({ id: 'l1' })),
  updateLines: vi.fn(async () => okResult([])),
  reorderLines: vi.fn(async () => okResult([])),
  deleteLines: vi.fn(async () => okResult([])),
}))
vi.mock('@auxx/lib/accounting/documents/edit-in-place', () => ({
  DOCUMENT_EDIT_FAMILIES: ['vendor_bill', 'credit_memo', 'invoice', 'journal_entry', 'quote'],
  documentEditRow: (family: string) => ({
    ledger: ['vendor_bill', 'credit_memo', 'invoice', 'journal_entry'].includes(family),
  }),
}))
vi.mock('@auxx/lib/cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, family: string) => DEF_IDS[family]),
}))
vi.mock('@auxx/lib/permissions', async () => {
  const { PermissionKey } = await import('@auxx/lib/permissions/capabilities/registry')
  return {
    PermissionKey,
    PERMISSION_REGISTRY_MAP: new Map(),
    FeaturePermissionService: class {
      async requireAccess() {}
    },
  }
})
vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())
vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    capabilityProcedure: t.procedure,
    isAuxxError: (error: unknown) =>
      typeof error === 'object' && error !== null && 'statusCode' in error,
  }
})

const { ForbiddenError, NotFoundError } = await import('@auxx/lib/errors')
const { PermissionKey } = await import('@auxx/lib/permissions/capabilities/registry')
const lib = await import('@auxx/lib/accounting/documents/lines')
const { linesRouter } = await import('./lines')

interface Grants {
  ledgerPost?: boolean
  edit?: string[]
  view?: string[]
}

function capabilitiesFor(grants: Grants) {
  return {
    assert: (key: string) => {
      if (key === PermissionKey.ledgerPost && grants.ledgerPost) return
      throw new ForbiddenError(`missing ${key}`)
    },
    assertEditEntity: (defId: string) => {
      if (!grants.edit?.includes(defId)) throw new ForbiddenError(`no edit on ${defId}`)
    },
    assertViewEntity: (defId: string) => {
      if (!grants.view?.includes(defId)) throw new ForbiddenError(`no view on ${defId}`)
    },
  }
}

const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => h.documentRows }) }) }),
}

function caller(grants: Grants) {
  return linesRouter.createCaller({
    capabilities: capabilitiesFor(grants),
    db,
    headers: new Headers({ 'x-realtime-socket-id': 'sock_1' }),
    session: { organizationId: ORG_ID, userId: USER_ID },
  } as never)
}

const patch = { lineId: 'l1', patch: { qty: 2 } }

beforeEach(() => {
  vi.clearAllMocks()
  h.documentRows = [{ id: 'doc_1' }]
})

describe('lines authority', () => {
  it('a ledger family needs ledgerPost, not edit on its def', async () => {
    const invoice = { documentType: 'invoice' as const, documentId: 'doc_1', ...patch }
    await expect(caller({ edit: ['def_invoice'] }).update(invoice)).rejects.toThrow(
      `missing ${PermissionKey.ledgerPost}`
    )
    expect(lib.updateLine).not.toHaveBeenCalled()

    await caller({ ledgerPost: true }).update(invoice)
    expect(lib.updateLine).toHaveBeenCalledWith(
      db,
      ORG_ID,
      USER_ID,
      expect.objectContaining({ documentType: 'invoice', documentId: 'doc_1' }),
      { socketId: 'sock_1' }
    )
  })

  it('any other family needs edit on its own def', async () => {
    const quote = { documentType: 'quote' as const, documentId: 'doc_1', ids: ['l1'] }
    await expect(caller({ ledgerPost: true }).delete(quote)).rejects.toThrow('no edit on def_quote')
    expect(lib.deleteLines).not.toHaveBeenCalled()

    await expect(caller({ edit: ['def_quote'] }).delete(quote)).resolves.toEqual({ deleted: [] })
  })

  it('list needs view on the parent def', async () => {
    const quote = { documentType: 'quote' as const, documentId: 'doc_1' }
    await expect(caller({ edit: ['def_quote'] }).list(quote)).rejects.toThrow(
      'no view on def_quote'
    )
    await expect(caller({ view: ['def_quote'] }).list(quote)).resolves.toEqual([])
  })

  it('refuses an id that is not a header of the named family', async () => {
    h.documentRows = []
    const error = await caller({ edit: ['def_quote'] })
      .reorder({ documentType: 'quote', documentId: 'inv_9', orderedIds: ['l1'] })
      .catch((e: { cause?: unknown }) => e.cause)
    expect(error).toBeInstanceOf(NotFoundError)
    expect(lib.reorderLines).not.toHaveBeenCalled()
  })

  it('refuses an engine-owned key at the door', async () => {
    await expect(
      caller({ edit: ['def_quote'] }).update({
        documentType: 'quote',
        documentId: 'doc_1',
        lineId: 'l1',
        patch: { netTotal: 5 } as never,
      })
    ).rejects.toThrow()
    expect(lib.updateLine).not.toHaveBeenCalled()
  })
})
