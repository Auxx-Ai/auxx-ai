// packages/lib/src/chat-widget/chat-widget-shared-only.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40a §2 — a chat widget must NEVER be routed to a personal inbox.
 *
 * A widget is a public front door: every visitor conversation it opens lands in
 * its linked inbox. Pointing one at a member's personal mailbox publishes a
 * private mailbox to the internet, and it also breaks the §11 isolation the
 * mail-visibility layer assumes (personal inboxes are floored at `none` with a
 * single owner grant, so widget traffic would be readable by nobody but them).
 *
 * `updateChatWidget` validated only that the inbox EXISTS. This is the guard,
 * plus its positive control: shared inboxes must keep working.
 */

const { getInboxById, getOrgChannelProviderMap } = vi.hoisted(() => ({
  getInboxById: vi.fn(),
  getOrgChannelProviderMap: vi.fn(),
}))

vi.mock('../inboxes/inbox-service', () => ({
  InboxService: class {
    getInboxById = getInboxById
  },
}))
vi.mock('../channels/cache', () => ({ getOrgChannelProviderMap }))
vi.mock('../cache', () => ({ onCacheEvent: vi.fn(async () => undefined) }))

const { updateChatWidget } = await import('./config')

const ORG = 'org_1'
const CHANNEL = 'int_chat'
const SHARED_ID = 'ibx_shared'
const PERSONAL_ID = 'ibx_personal'

/** Records what the update transaction did, so "nothing was written" is assertable. */
function makeCtx() {
  const writes: string[] = []
  const chain = () => {
    const c: Record<string, unknown> = {}
    c.set = () => c
    c.values = () => c
    c.where = async () => undefined
    return c
  }
  return {
    writes,
    ctx: {
      organizationId: ORG,
      db: {
        query: { ChatWidget: { findFirst: async () => ({ id: 'cw_1' }) } },
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          writes.push('transaction')
          return cb({
            update: () => chain(),
            insert: () => chain(),
            delete: () => ({ where: async () => undefined }),
          })
        },
      },
    } as never,
  }
}

const inbox = (id: string, isPersonal: boolean) => ({
  id,
  recordId: `${isPersonal ? 'personal_inbox' : 'inbox'}:${id}`,
  entityDefinitionKey: isPersonal ? 'personal_inbox' : 'inbox',
  isPersonal,
  ownerUserId: isPersonal ? 'usr_owner' : null,
  organizationId: ORG,
})

beforeEach(() => {
  getInboxById.mockReset()
  getOrgChannelProviderMap.mockReset()
  getOrgChannelProviderMap.mockResolvedValue(new Map([[CHANNEL, 'chat']]))
})

describe('updateChatWidget — inbox destination is shared-only', () => {
  it('refuses a personal inbox, and writes nothing', async () => {
    const { ctx, writes } = makeCtx()
    getInboxById.mockResolvedValue(inbox(PERSONAL_ID, true))

    const result = await updateChatWidget(ctx, CHANNEL, { inboxId: PERSONAL_ID })

    expect(result.error).toMatchObject({ name: 'BadRequestError', statusCode: 400 })
    expect(writes).toEqual([])
  })

  it('accepts a shared inbox (positive control)', async () => {
    const { ctx, writes } = makeCtx()
    getInboxById.mockResolvedValue(inbox(SHARED_ID, false))

    const result = await updateChatWidget(ctx, CHANNEL, { inboxId: SHARED_ID })

    expect(result.error).toBeUndefined()
    expect(writes).toEqual(['transaction'])
  })

  it('still refuses an inbox that does not exist', async () => {
    const { ctx } = makeCtx()
    getInboxById.mockResolvedValue(null)

    const result = await updateChatWidget(ctx, CHANNEL, { inboxId: SHARED_ID })

    expect(result.error).toMatchObject({ name: 'BadRequestError' })
  })

  it('unlinking (`inboxId: null`) skips the check entirely', async () => {
    const { ctx } = makeCtx()

    const result = await updateChatWidget(ctx, CHANNEL, { inboxId: null })

    expect(result.error).toBeUndefined()
    expect(getInboxById).not.toHaveBeenCalled()
  })
})
