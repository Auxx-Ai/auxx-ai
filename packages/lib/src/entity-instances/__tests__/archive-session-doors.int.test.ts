// packages/lib/src/entity-instances/__tests__/archive-session-doors.int.test.ts
//
// DB-backed behaviour test (vitest.integration.config.ts → auxx_test) for the archive/
// restore row write's two door decisions in
// plans/events/03-write-context-and-batch-lane-plan.md:
//
//   D-7 — `updatedAt` is stamped EXPLICITLY (the `$onUpdate` auto-bump is gone), so
//         archive/restore must stamp it itself or the content change becomes invisible.
//   D-1 × seed — archive/restore advances `lastActivityAt` because it IS activity,
//         EXCEPT under a seed write session, where the door matrix says
//         `lastActivityAt × seed = off` while `updatedAtStamp × seed = per-record`.
//
// WHY INTEGRATION. The claim is that ONE update statement writes a DIFFERENT COLUMN SET
// depending on the ambient AsyncLocalStorage session — `updatedAt` always, `archivedAt`
// when asked, `lastActivityAt` conditionally. `updated-at-stamp.test.ts` asserts that by
// inspecting the object handed to a mocked `.set()`. This file asserts the stored row,
// which is also the only way to catch the column set diverging from what the table
// actually accepts.
//
// `updateEntityInstance` reads the module-level `database` singleton rather than an
// injected db — under this config that singleton resolves from the same `.env.test`
// DATABASE_URL the harness uses, and these tests confirm it by round-tripping rows
// created through `getTestDb()`.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { interactiveSession, seedSession } from '../../resources/crud/write-origin'
import { runWithWriteSession } from '../../resources/crud/write-session-als'
import { updateEntityInstance } from '../update-entity-instance'

const db = () => getTestDb() as never as Database

interface Fixture {
  orgId: string
  defId: string
}

async function seed(): Promise<Fixture> {
  const org = await createTestOrganization()
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      entityType: 'contact',
      apiSlug: 'contacts',
      singular: 'contact',
      plural: 'contacts',
      updatedAt: new Date(),
    })
    .returning()
  return { orgId: org.id, defId: def!.id }
}

/** An instance stamped an hour in the past, so any bump is unambiguous. */
async function instance(f: Fixture, over: Record<string, unknown> = {}): Promise<string> {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      displayName: 'Ada',
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      ...over,
    })
    .returning()
  return row!.id
}

async function row(id: string) {
  const [r] = await db()
    .select()
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, id))
  return r!
}

let f: Fixture
beforeEach(async () => {
  f = await seed()
})

describe('archive / restore row write', () => {
  it('under an interactive session: archives, stamps updatedAt, advances lastActivityAt', async () => {
    const id = await instance(f)
    const before = await row(id)

    const result = await runWithWriteSession(interactiveSession('user_1'), () =>
      updateEntityInstance({ id, organizationId: f.orgId, data: { archivedAt: new Date() } })
    )
    expect(result.isOk()).toBe(true)

    const after = await row(id)
    expect(after.archivedAt).not.toBeNull()
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    expect(after.lastActivityAt).not.toBeNull()
  })

  it('under a SEED session: archives and stamps updatedAt, but lastActivityAt stays untouched', async () => {
    const id = await instance(f)
    const before = await row(id)

    const result = await runWithWriteSession(seedSession('fixture'), () =>
      updateEntityInstance({ id, organizationId: f.orgId, data: { archivedAt: new Date() } })
    )
    expect(result.isOk()).toBe(true)

    const after = await row(id)
    expect(after.archivedAt).not.toBeNull()
    // updatedAtStamp × seed = per-record — the content stamp still applies.
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    // lastActivityAt × seed = off — seeded data is not activity.
    expect(after.lastActivityAt).toBeNull()
  })

  it('a seed session does NOT rewind an existing lastActivityAt either', async () => {
    const existing = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const id = await instance(f, { lastActivityAt: existing })

    await runWithWriteSession(seedSession('fixture'), () =>
      updateEntityInstance({ id, organizationId: f.orgId, data: { archivedAt: new Date() } })
    )

    expect((await row(id)).lastActivityAt?.getTime()).toBe(existing.getTime())
  })

  it('restore is activity too — lastActivityAt advances on un-archive', async () => {
    const id = await instance(f, { archivedAt: new Date(Date.now() - 60 * 60 * 1000) })

    await runWithWriteSession(interactiveSession('user_1'), () =>
      updateEntityInstance({ id, organizationId: f.orgId, data: { archivedAt: null } })
    )

    const after = await row(id)
    expect(after.archivedAt).toBeNull()
    expect(after.lastActivityAt).not.toBeNull()
  })

  it('with NO ambient session at all, it behaves as non-seed (the safe default)', async () => {
    const id = await instance(f)

    await updateEntityInstance({ id, organizationId: f.orgId, data: { archivedAt: new Date() } })

    expect((await row(id)).lastActivityAt).not.toBeNull()
  })

  it('a non-archive update stamps updatedAt and leaves lastActivityAt alone', async () => {
    const id = await instance(f)
    const before = await row(id)

    await runWithWriteSession(interactiveSession('user_1'), () =>
      updateEntityInstance({ id, organizationId: f.orgId, data: {} })
    )

    const after = await row(id)
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    // Only the `archivedAt` branch touches activity.
    expect(after.lastActivityAt).toBeNull()
  })

  it('is org-scoped — a matching id under another org is not touched', async () => {
    const other = await seed()
    const id = await instance(f)

    const result = await runWithWriteSession(interactiveSession('user_1'), () =>
      updateEntityInstance({ id, organizationId: other.orgId, data: { archivedAt: new Date() } })
    )

    expect(result.isErr()).toBe(true)
    expect((await row(id)).archivedAt).toBeNull()
  })
})
