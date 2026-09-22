// packages/lib/src/accounting/money/invoice-payments/__tests__/apply-money-quote-link.test.ts
//
// MIGRATION follow-up 7: a deposit application names the quote the money was
// held against on its own row, so nothing has to read it back out of
// `MoneyCommand.actorSnapshot`.

import { beforeEach, expect, it, vi } from 'vitest'

const runMoneyCommand = vi.hoisted(() => vi.fn())
vi.mock('../../commands/run-money-command', () => ({ runMoneyCommand }))
vi.mock('../../../sales/invoices/issuance-reads', () => ({
  loadInvoiceForIssuance: async () => ({ totalMinor: 50_000 }),
}))

const { applyMoneyToInvoice } = await import('../apply-money')

/** The one row the insert wrote, captured out of the command's body. */
let written: Record<string, unknown> | undefined

const input = {
  organizationId: 'org',
  userId: 'user',
  moneyTransactionId: 'money-1',
  invoiceInstanceId: 'invoice-1',
  amountMinor: 20_000,
  effectiveDate: '2026-09-15',
  commandKey: 'deposit-apply:money-1:invoice-1',
}

beforeEach(() => {
  written = undefined
  runMoneyCommand.mockReset()
  runMoneyCommand.mockImplementation(
    async (_db: unknown, _command: unknown, body: (tx: unknown, commandId: string) => unknown) => {
      const tx = {
        query: {
          MoneyTransaction: {
            findMany: async () => [{ id: 'money-1', amountMinor: 50_000n }],
          },
          MoneyApplication: { findMany: async () => [] },
        },
        select: () => {
          const chain: Record<string, unknown> = {}
          for (const method of ['from', 'innerJoin', 'where', 'limit']) chain[method] = () => chain
          // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
          chain.then = (resolve: (v: unknown) => unknown) =>
            Promise.resolve([{ id: 'invoice-1', totalMinor: 50_000 }]).then(resolve)
          return chain
        },
        insert: () => ({
          values: (values: Record<string, unknown>) => {
            written = values
            return { returning: async () => [{ id: 'app-1' }] }
          },
        }),
      }
      return body(tx, 'cmd-1')
    }
  )
})

it('stamps the quote on the application when one was supplied', async () => {
  await applyMoneyToInvoice({} as never, { ...input, quoteInstanceId: 'quote-9' })

  expect(written).toMatchObject({
    invoiceInstanceId: 'invoice-1',
    quoteInstanceId: 'quote-9',
  })
})

// 🛑 Absent, never null-stamped: an ordinary invoice payment has no quote, and
// a column that read `null` for "unknown" and for "there was none" answers
// neither question.
it('leaves the column alone for an application with no quote behind it', async () => {
  await applyMoneyToInvoice({} as never, input)

  expect(written).toMatchObject({ quoteInstanceId: null })
})
