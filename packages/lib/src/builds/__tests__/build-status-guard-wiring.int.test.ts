// packages/lib/src/builds/__tests__/build-status-guard-wiring.int.test.ts
//
// DB-backed tests (vitest.integration.config.ts -> auxx_test) for the half of
// the `build_status` lifecycle guard that no unit test can reach: the WIRING.
//
// `pre/build-status-guard.test.ts` proves the handler's matching logic — that it
// refuses the coerced `{ type: 'option', optionId }` envelope the field chain
// actually delivers, and leaves `planned` alone.
// `__tests__/build-status-guard-registration.test.ts` proves it is registered
// under `builds` and has no system twin. Neither can see past its own double of
// `UnifiedCrudHandler`, and so neither can answer the question that actually
// decides whether this feature works:
//
//   🛑 **Does `bypassFieldGuards: ['build_status']` reach `fireFieldPreHooks`?**
//
// If a bypass were missing from any of the five sanctioned writers, the guard
// would refuse the very button it exists to protect — Complete would simply stop
// working — and every existing test would still be green, because they all stub
// the handler that carries the set. That is the "half a fix" failure mode: a
// wall that keeps out the owner and nobody else.
//
// So every writer below runs for real, through the real
// `UnifiedCrudHandler` -> `FieldValueService` -> `fireFieldPreHooks` chain,
// against a real organization whose `build` def and fields came from the
// registry. And the other direction is exercised on the SAME record through the
// door an interactive drawer edit takes — `fieldValue.set`'s
// `FieldValueService.setValueWithBuiltIn`, constructed with no bypass at all.
//
// `reverseBuild` gets its own case: it writes `completed` on a **CREATE**, and
// the field pre-hook chain has no `operation === 'create'` exemption.

import type { Database } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import type { FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../cache'
import { guardManualBuildLifecycleStatus } from '../../field-hooks/pre/build-status-guard'
import { getFieldPreHooks, hasFieldPreHooks } from '../../field-hooks/registry'
import { FieldValueService } from '../../field-values'
import {
  BUILD_ACTION_STATUS_MESSAGE,
  BUILD_ACTION_STATUSES,
} from '../../resources/hooks/lifecycle-status-guard'
import { BuildStatus } from '../../resources/registry/enum-values'
import { toRecordId } from '../../resources/resource-id'
import { cancelBuild, createBuild, startBuild } from '../build-mutations'
import { getBuild } from '../build-queries'
import { completeBuild } from '../complete-build'
import { reverseBuild } from '../reverse-build'
import { type BuildFixture, seedBuildOrg } from './support/build-fixture'

// ── The two queue-backed externals, mocked OFF ───────────────────────────────
//
// ⚠️ Not decoration — without these the suite hangs forever rather than failing.
// `publisher.publishLater` and `enqueueDuplicateScan` are BullMQ writes, and
// BullMQ's default `maxRetriesPerRequest: null` means a command issued against
// an unreachable Redis never settles. `publishLater` is AWAITED on the
// interactive write lane, which is the lane `createBuild` / `startBuild` /
// `cancelBuild` take. Nothing in the guard chain goes near either one.

vi.mock('../../events/publisher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, publisher: { publish: async () => {}, publishLater: async () => {} } }
})

vi.mock('../../dedup/enqueue-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../dedup/enqueue-scan')>()
  return { ...actual, enqueueDuplicateScan: async () => {} }
})

const db = () => getTestDb() as unknown as Database

const QUANTITY = 4

let f: BuildFixture

beforeEach(async () => {
  f = await seedBuildOrg()
})

/** Raise a build through the sanctioned door. */
async function raise(): Promise<string> {
  const created = await createBuild(db(), f.organizationId, f.userId, {
    partId: f.producedPartId,
    quantityPlanned: QUANTITY,
  })
  if (created.isErr()) throw created.error
  return created.value.buildId
}

async function statusOf(buildId: string): Promise<string | null> {
  const result = await getBuild(db(), f.organizationId, buildId)
  if (result.isErr()) throw result.error
  return result.value?.status ?? null
}

/** The `build_status` `CustomField.id` for this org. */
async function buildStatusFieldId(): Promise<FieldId> {
  const fields = await getOrgCache()
    .from(f.organizationId, 'customFields')
    .bySystemAttributes(['build_status'] as const)
  const field = fields.build_status
  if (!field) throw new Error('build_status was not seeded')
  return field.id as FieldId
}

/**
 * The write an interactive drawer edit makes: `fieldValue.set` builds a
 * `FieldValueService` with no `bypassFieldGuards` at all, and that is the ONLY
 * difference between this and what `startBuild` does two lines above.
 */
async function unsanctionedStatusWrite(buildId: string, value: unknown): Promise<void> {
  const service = new FieldValueService(f.organizationId, f.userId, db())
  await service.setValueWithBuiltIn({
    recordId: toRecordId(f.buildDefId, buildId) as RecordId,
    fieldId: await buildStatusFieldId(),
    value,
  })
}

// ── Anti-vacuity ─────────────────────────────────────────────────────────────

describe('the guard is registered and armed in this process', () => {
  // 🛑 Without this, every "the sanctioned writer still works" case below would
  // pass just as happily against a guard that was never registered — which is
  // precisely the state PR #1949 was written to leave behind, and precisely what
  // a wiring test must not be blind to.
  it('is on the field pre-hook chain for builds', () => {
    expect(hasFieldPreHooks('builds', 'build_status')).toBe(true)
    expect(getFieldPreHooks('builds', 'build_status')).toContain(guardManualBuildLifecycleStatus)
  })

  it('guards exactly the three action statuses', () => {
    expect([...BUILD_ACTION_STATUSES]).toEqual(['in_progress', 'completed', 'canceled'])
  })
})

// ── The five sanctioned writers ──────────────────────────────────────────────

describe('every sanctioned writer still gets through', () => {
  it('createBuild lands planned', async () => {
    const buildId = await raise()
    expect(await statusOf(buildId)).toBe(BuildStatus.PLANNED)
  })

  it('startBuild lands in_progress', async () => {
    const buildId = await raise()
    const started = await startBuild(db(), f.organizationId, f.userId, { buildId })
    if (started.isErr()) throw started.error
    expect(await statusOf(buildId)).toBe(BuildStatus.IN_PROGRESS)
  })

  it('cancelBuild lands canceled', async () => {
    const buildId = await raise()
    const canceled = await cancelBuild(db(), f.organizationId, f.userId, {
      buildId,
      reason: 'floor stopped the run',
    })
    if (canceled.isErr()) throw canceled.error
    expect(await statusOf(buildId)).toBe(BuildStatus.CANCELED)
  })

  it('completeBuild lands completed', async () => {
    const buildId = await raise()
    const started = await startBuild(db(), f.organizationId, f.userId, { buildId })
    if (started.isErr()) throw started.error

    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY,
    })
    if (done.isErr()) throw done.error
    expect(await statusOf(buildId)).toBe(BuildStatus.COMPLETED)
  })

  // 🛑 The asymmetric one. `reverseBuild` writes `completed` on a CREATE, and
  // `applyDefaults` + `fireFieldPreHooks` treat a create carrying a guarded value
  // exactly like an update. A missing bypass here would break B6's only
  // correction for a posted run while leaving Start / Complete / Cancel working,
  // so it cannot be inferred from the other four passing.
  it('reverseBuild creates its reversing build AT completed', async () => {
    const buildId = await raise()
    const started = await startBuild(db(), f.organizationId, f.userId, { buildId })
    if (started.isErr()) throw started.error
    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY,
    })
    if (done.isErr()) throw done.error

    const reversed = await reverseBuild(db(), f.organizationId, f.userId, { buildId })
    if (reversed.isErr()) throw reversed.error

    expect(await statusOf(reversed.value.buildId)).toBe(BuildStatus.COMPLETED)
    expect(reversed.value.buildId).not.toBe(buildId)
  })
})

// ── The door the guard exists to close ───────────────────────────────────────

describe('an unsanctioned write of a guarded value is refused', () => {
  it.each([...BUILD_ACTION_STATUSES])('refuses a raw fieldValue.set of %s', async (status) => {
    const buildId = await raise()
    await expect(unsanctionedStatusWrite(buildId, status)).rejects.toThrow(
      BUILD_ACTION_STATUS_MESSAGE
    )
  })

  it('leaves the stored status untouched when it refuses', async () => {
    const buildId = await raise()
    await expect(unsanctionedStatusWrite(buildId, BuildStatus.COMPLETED)).rejects.toThrow()
    expect(await statusOf(buildId)).toBe(BuildStatus.PLANNED)
  })

  // 🛑 The defect this whole guard was built for: a build reading `completed`
  // with no consume rows, no produce row and no costs behind it.
  it('writes no stock movements on the refused path — the ledger stays empty', async () => {
    const buildId = await raise()
    await expect(unsanctionedStatusWrite(buildId, BuildStatus.COMPLETED)).rejects.toThrow()

    const build = await getBuild(db(), f.organizationId, buildId)
    if (build.isErr()) throw build.error
    expect(build.value?.status).toBe(BuildStatus.PLANNED)
    expect(build.value?.materialCost).toBeFalsy()
    expect(build.value?.producedValue).toBeFalsy()
  })

  // The other side of the same wall. `planned` is `build_status`'s defaultValue
  // and every create carries it, so guarding it would refuse every build create
  // through the generic door. A refusal here would mean the guard had become a
  // FIELD wall rather than a VALUE wall.
  it('still allows an unsanctioned write of planned', async () => {
    const buildId = await raise()
    const started = await startBuild(db(), f.organizationId, f.userId, { buildId })
    if (started.isErr()) throw started.error

    // Not `rejects` — a throw here fails the test, and the stored value is the
    // claim: the write went all the way through.
    await unsanctionedStatusWrite(buildId, BuildStatus.PLANNED)
    expect(await statusOf(buildId)).toBe(BuildStatus.PLANNED)
  })
})
