// packages/lib/src/approvals/__tests__/bundle-service.test.ts

import { describe, expect, it } from 'vitest'
import { Result } from '../../result'
import { createBundleFromHeadlessRun } from '../bundle-service'
import type { HeadlessRunResult } from '../types'

/**
 * Bundle-service unit tests focus on the zero-action skip path — the only
 * branch that doesn't touch the DB. End-to-end DB integration lives in the
 * worker job's E2E test (Day 3 deliverable, requires seeded fixtures).
 */
describe('createBundleFromHeadlessRun', () => {
  it('returns Result.ok(undefined) when actions is empty (no row inserted)', async () => {
    const result: HeadlessRunResult = {
      actions: [],
      summary: undefined,
      noopReason: 'customer already replied',
      modelId: 'openai:gpt-4',
      headlessTraceId: 'hrun-test',
      computedForActivityAt: new Date(),
      entityDefinitionId: 'def-1',
    }

    // The DB handle is never touched on the empty-actions path; passing a
    // throwing proxy proves it.
    const dbStub = new Proxy(
      {},
      {
        get() {
          throw new Error('DB should not be touched on empty-actions path')
        },
      }
    ) as unknown as Parameters<typeof createBundleFromHeadlessRun>[0]

    const out = await createBundleFromHeadlessRun(dbStub, {
      result,
      organizationId: 'org-1',
      ownerUserId: 'user-1',
      entityInstanceId: 'ei-1',
      entityDefinitionId: 'def-1',
      triggerSource: 'stale_scan',
    })

    expect(Result.isOk(out)).toBe(true)
    if (Result.isOk(out)) {
      expect(out.value).toBeUndefined()
    }
  })
})
