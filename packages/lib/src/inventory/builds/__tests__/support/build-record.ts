// packages/lib/src/inventory/builds/__tests__/support/build-record.ts

import type { BuildRecord } from '../../types'

/** A `planned` manual build record for unit-test doubles; override what the test is about. */
export function buildRecord(over: Partial<BuildRecord> = {}): BuildRecord {
  return {
    buildId: 'bld_1',
    number: 'B-0001',
    partId: 'part_lift',
    status: 'planned',
    source: 'manual',
    quantityPlanned: 10,
    quantityProduced: null,
    quantityScrapped: null,
    startedAt: null,
    completedAt: null,
    postedAt: null,
    materialCost: null,
    laborCost: null,
    overheadCost: null,
    producedValue: null,
    varianceAmount: null,
    notes: null,
    orderId: null,
    reversalOfBuildId: null,
    orderRevision: null,
    periodStart: null,
    periodEnd: null,
    batchRun: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdById: null,
    ...over,
  }
}
