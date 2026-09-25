// packages/lib/src/data-connectors/__tests__/refresh-outcome.test.ts

import { describe, expect, it } from 'vitest'
import { describeRecordRefresh, type RefreshRunSummary } from '../refresh-outcome'

const ID_CLAUSE = { fieldId: '$externalId', operator: 'in' }
const CUTOVER_CLAUSE = { fieldId: 'createdAt', operator: 'between' }

const run = (over: Partial<RefreshRunSummary> = {}): RefreshRunSummary => ({
  status: 'completed',
  created: 0,
  updated: 0,
  skipped: 0,
  recordFilter: [ID_CLAUSE],
  errorSample: null,
  ...over,
})

const done = (tone: string, message: string) => ({ state: 'done', tone, message })

describe('describeRecordRefresh', () => {
  it('waits for the run row, then reports it running', () => {
    expect(describeRecordRefresh(null, 'Shopify')).toEqual({ state: 'waiting' })
    expect(describeRecordRefresh(run({ status: 'running' }), 'Shopify')).toEqual({
      state: 'running',
    })
  })

  it('reads the counts of a completed run', () => {
    expect(describeRecordRefresh(run({ updated: 1 }), 'Shopify')).toEqual(
      done('success', 'Updated')
    )
    expect(describeRecordRefresh(run({ skipped: 1 }), 'Shopify')).toEqual(
      done('neutral', 'Unchanged')
    )
  })

  it('tells a pre-cutover record from one the source no longer has', () => {
    expect(
      describeRecordRefresh(run({ recordFilter: [ID_CLAUSE, CUTOVER_CLAUSE] }), 'Shopify')
    ).toEqual(done('neutral', 'This record is from before your books started in auxx'))
    expect(describeRecordRefresh(run(), 'Shopify')).toEqual(done('neutral', 'Not found in Shopify'))
  })

  it('surfaces the run error, preferring the engine-level one, shortened', () => {
    const failed = run({
      status: 'failed',
      errorSample: [
        { externalId: '5512', error: 'record write threw' },
        { externalId: '', error: 'Shopify can’t refresh a single payout' },
      ],
    })
    expect(describeRecordRefresh(failed, 'Shopify')).toEqual(
      done('error', 'Shopify can’t refresh a single payout')
    )

    const long = run({
      status: 'partial',
      errorSample: [{ externalId: '1', error: 'x'.repeat(400) }],
    })
    const outcome = describeRecordRefresh(long, 'Shopify')
    expect(outcome.state === 'done' && outcome.message.length).toBe(160)
    expect(describeRecordRefresh(run({ status: 'failed' }), 'Shopify')).toEqual(
      done('error', 'The refresh failed.')
    )
  })
})
