// packages/lib/src/entity-instances/__tests__/interaction-touch.test.ts
//
// records/interaction-fields plan §4 — the interaction touch must be
// order-independent: first-wins/last-wins guards mean shuffled backfill
// batches, concurrent walkers and live mail all converge to the same four
// values. Drizzle conditions are opaque under vitest (columns are plain proxy
// objects), so the in-memory stand-in mirrors the SQL guard semantics keyed on
// which column pair a `.set()` payload carries and locates target rows by
// finding known ids inside the built condition — the assertions are about what
// the code under test SENDS (timestamps, message ids, entity sets), which is
// where an orchestration bug would live.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  // In-memory EntityInstance rows keyed by id.
  entities: new Map<
    string,
    {
      organizationId: string
      firstInteractionAt: Date | null
      firstInteractionMessageId: string | null
      lastInteractionAt: Date | null
      lastInteractionMessageId: string | null
    }
  >(),
  threadPrimary: null as string | null,
  threadLinkIds: [] as string[],
  /** Pre-shaped resolver rows for the message's participant-linked contacts. */
  messageContactRows: [] as Array<{ contactId: string | null }>,
  /** contactId → companyId rows behind the `contact_employer` field. */
  employerLinks: [] as Array<{ entityId: string; companyId: string }>,
  employerField: { id: 'cf_employer' } as { id: string } | null,
  selectedTables: [] as string[],
  updateCalls: 0,
  failUpdates: false,
}))

vi.mock('../../cache/singletons', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({ contact_employer: h.employerField }),
    }),
  }),
}))

vi.mock('drizzle-orm', () => {
  const passthrough = (...a: unknown[]) => a
  return {
    and: passthrough,
    or: passthrough,
    eq: passthrough,
    inArray: (_col: unknown, ids: unknown) => ({ __ids: ids }),
    isNotNull: passthrough,
    sql: Object.assign(passthrough, { raw: passthrough }),
  }
})

/** Deep-search a built condition for the `inArray` id list. */
function findIds(cond: unknown, depth = 0): string[] {
  if (depth > 8 || cond === null || typeof cond !== 'object') return []
  const record = cond as Record<string, unknown>
  if (Array.isArray(record.__ids)) return record.__ids as string[]
  for (const v of Object.values(record)) {
    const found = findIds(v, depth + 1)
    if (found.length > 0) return found
  }
  return []
}

vi.mock('@auxx/database', async () => {
  const { createSchemaMock } = await import('../../test/database-mock')
  const schema = createSchemaMock()

  const makeSelectChain = (table: unknown): any => {
    const rowsFor = (): unknown[] => {
      if (table === schema.Thread) {
        h.selectedTables.push('Thread')
        return h.threadPrimary ? [{ id: h.threadPrimary }] : [{ id: null }]
      }
      if (table === schema.ThreadEntityLink) {
        h.selectedTables.push('ThreadEntityLink')
        return h.threadLinkIds.map((id) => ({ id }))
      }
      if (table === schema.FieldValue) {
        h.selectedTables.push('FieldValue')
        return h.employerLinks.map((l) => ({ companyId: l.companyId }))
      }
      if (table === schema.MessageParticipant) {
        h.selectedTables.push('MessageParticipant')
        return h.messageContactRows
      }
      return []
    }
    const chain: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (res: (v: unknown[]) => unknown) => Promise.resolve(res(rowsFor()))
          }
          return () => chain
        },
      }
    )
    return chain
  }

  const database = {
    select: () => ({ from: (table: unknown) => makeSelectChain(table) }),
    selectDistinct: () => ({ from: (table: unknown) => makeSelectChain(table) }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          if (h.failUpdates) return Promise.reject(new Error('boom'))
          h.updateCalls += 1
          const ids = findIds(cond)
          // Mirror the SQL guards: first-wins / last-wins on sentAt.
          for (const id of ids) {
            const row = h.entities.get(id)
            if (!row) continue
            if ('firstInteractionAt' in vals) {
              const at = vals.firstInteractionAt as Date
              if (row.firstInteractionAt === null || row.firstInteractionAt > at) {
                row.firstInteractionAt = at
                row.firstInteractionMessageId = vals.firstInteractionMessageId as string
              }
            }
            if ('lastInteractionAt' in vals) {
              const at = vals.lastInteractionAt as Date
              if (row.lastInteractionAt === null || row.lastInteractionAt < at) {
                row.lastInteractionAt = at
                row.lastInteractionMessageId = vals.lastInteractionMessageId as string
              }
            }
          }
          return Promise.resolve()
        },
      }),
    }),
  }

  return { database, schema, Database: class {}, Transaction: class {} }
})

import { touchEntityInteraction, touchInteractionForMessage } from '../activity'

const ORG = 'org_1'

const entityRow = () => ({
  organizationId: ORG,
  firstInteractionAt: null,
  firstInteractionMessageId: null,
  lastInteractionAt: null,
  lastInteractionMessageId: null,
})

beforeEach(() => {
  h.entities.clear()
  h.entities.set('contact_1', entityRow())
  h.entities.set('company_1', entityRow())
  h.threadPrimary = 'ticket_1'
  h.threadLinkIds = []
  h.messageContactRows = []
  h.employerLinks = []
  h.employerField = { id: 'cf_employer' }
  h.selectedTables = []
  h.updateCalls = 0
  h.failUpdates = false
})

describe('touchEntityInteraction', () => {
  const messages: Array<[string, Date]> = [
    ['m_a', new Date('2026-01-05T10:00:00Z')],
    ['m_b', new Date('2026-03-01T10:00:00Z')],
    ['m_c', new Date('2026-02-10T10:00:00Z')],
  ]

  const applyAll = async (order: Array<[string, Date]>) => {
    for (const [id, at] of order) {
      await touchEntityInteraction(['contact_1'], ORG, id, at)
    }
  }

  it('converges to oldest-first / newest-last regardless of processing order', async () => {
    const orders = [messages, [...messages].reverse(), [messages[2]!, messages[0]!, messages[1]!]]
    for (const order of orders) {
      h.entities.set('contact_1', entityRow())
      await applyAll(order)
      const row = h.entities.get('contact_1')!
      expect(row.firstInteractionAt).toEqual(new Date('2026-01-05T10:00:00Z'))
      expect(row.firstInteractionMessageId).toBe('m_a')
      expect(row.lastInteractionAt).toEqual(new Date('2026-03-01T10:00:00Z'))
      expect(row.lastInteractionMessageId).toBe('m_b')
    }
  })

  it('is a no-op for an empty entity set', async () => {
    await touchEntityInteraction([], ORG, 'm_a', new Date())
    expect(h.updateCalls).toBe(0)
  })

  it('re-stamping the same message (sender path + sync echo) changes nothing', async () => {
    // An Auxx-sent message is stamped at send-confirm; if any later path
    // replays it (a provider re-pull, a retried job), the strict guards make
    // the second application a pure no-op — no rewind, no message-id churn.
    const at = new Date('2026-04-01T12:00:00Z')
    await touchEntityInteraction(['contact_1'], ORG, 'm_sent', at)
    const snapshot = structuredClone(h.entities.get('contact_1'))
    await touchEntityInteraction(['contact_1'], ORG, 'm_sent', at)
    expect(h.entities.get('contact_1')).toEqual(snapshot)
  })

  it('swallows database failures (best-effort contract)', async () => {
    h.failUpdates = true
    await expect(
      touchEntityInteraction(['contact_1'], ORG, 'm_a', new Date())
    ).resolves.toBeUndefined()
  })
})

describe('touchInteractionForMessage', () => {
  const SENT = new Date('2026-05-01T09:00:00Z')

  it('stamps the participant-linked contacts AND their companies — never the thread links', async () => {
    // The thread's primary is a ticket; interaction targets come from the
    // message's own correspondents, so the ticket stays untouched and the
    // thread tables are never consulted.
    h.entities.set('ticket_1', entityRow())
    h.messageContactRows = [{ contactId: 'contact_1' }]
    h.employerLinks = [{ entityId: 'contact_1', companyId: 'company_1' }]
    await touchInteractionForMessage('m_x', ORG, SENT)
    expect(h.entities.get('contact_1')!.lastInteractionAt).toEqual(SENT)
    expect(h.entities.get('company_1')!.lastInteractionAt).toEqual(SENT)
    expect(h.entities.get('company_1')!.lastInteractionMessageId).toBe('m_x')
    expect(h.entities.get('ticket_1')!.lastInteractionAt).toBeNull()
    expect(h.selectedTables).not.toContain('Thread')
    expect(h.selectedTables).not.toContain('ThreadEntityLink')
  })

  it('does not stamp companies with no contact link', async () => {
    h.messageContactRows = [{ contactId: 'contact_1' }]
    await touchInteractionForMessage('m_x', ORG, SENT)
    expect(h.entities.get('contact_1')!.lastInteractionAt).toEqual(SENT)
    expect(h.entities.get('company_1')!.lastInteractionAt).toBeNull()
  })

  it('reuses pre-resolved contact ids without querying MessageParticipant', async () => {
    await touchInteractionForMessage('m_x', ORG, SENT, { contactIds: ['contact_1'] })
    expect(h.selectedTables).not.toContain('MessageParticipant')
    expect(h.entities.get('contact_1')!.firstInteractionAt).toEqual(SENT)
  })

  it('no-ops when the message has no participant-linked contacts', async () => {
    h.messageContactRows = []
    await touchInteractionForMessage('m_x', ORG, SENT)
    expect(h.updateCalls).toBe(0)
  })
})
