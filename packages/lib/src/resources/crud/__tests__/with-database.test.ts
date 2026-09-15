// packages/lib/src/resources/crud/__tests__/with-database.test.ts
import type { Database, Transaction } from '@auxx/database'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { runInTxWrite } from '../tx-write-scope'
import { UnifiedCrudHandler } from '../unified-handler'
import { interactiveSession, seedSession } from '../write-origin'

describe('handler transaction rebinding', () => {
  it('preserves identity, socket, guard authorization and explicit write origin', () => {
    const pool = {} as Database
    const tx = {} as Transaction
    const bypass = new Set<SystemAttribute>(['fulfillment_shipped_at'])
    const session = interactiveSession('user', 'socket')
    const handler = new UnifiedCrudHandler('org', 'user', pool, 'socket', {
      bypassFieldGuards: bypass,
      session,
    })
    const bound = handler.withDatabase(tx)
    expect(bound.fieldValueService.ctx).toMatchObject({
      db: tx,
      organizationId: 'org',
      userId: 'user',
      socketId: 'socket',
    })
    expect(bound.fieldValueService.ctx.bypassFieldGuards).toBe(bypass)
    expect(bound.fieldValueService.ctx.session).toBe(session)
    expect(handler.fieldValueService.ctx.db).toBe(pool)
  })
  it('joins the current notification buffer for an interactive handler created before the transaction', async () => {
    const handler = new UnifiedCrudHandler('org', 'user', {} as Database)
    const result = await runInTxWrite(
      { organizationId: 'org', actorUserId: 'user' },
      async (scope) => {
        const bound = handler.withDatabase({} as Transaction)
        expect(bound.fieldValueService.ctx.session?.mode).toEqual({ kind: 'buffered', scope })
      }
    )
    expect(result.owned).toBe(true)
  })
  it('keeps a declared silent session silent when binding it inside a transaction buffer', async () => {
    const session = seedSession('fixture')
    const handler = new UnifiedCrudHandler('org', 'user', {} as Database, undefined, { session })
    await runInTxWrite({ organizationId: 'org', actorUserId: 'user' }, async () => {
      expect(handler.withDatabase({} as Transaction).fieldValueService.ctx.session).toBe(session)
    })
  })
})
