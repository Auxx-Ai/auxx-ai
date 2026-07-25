// packages/lib/src/agents/agent-cross-tenant-write.int.test.ts
//
// DB-backed regression tests (vitest.integration.config.ts → auxx_test database)
// for the tenant scope of the `Agent`-row write paths. `updateAgent` and
// `batchUpdateAgentToolsets` both take an `organizationId`, and every statement
// they issue against `Agent` must carry it: without the predicate any caller
// holding a foreign agent id writes across the tenant boundary, and a guard at
// one call site (the Kopilot authoring tools) does not protect the others
// (tRPC routers, workers, evals, future callers).
//
// Written as integration tests rather than db-mocked unit tests on purpose: the
// defect lives in the SQL `WHERE` clause, and under the plain `vitest.config.ts`
// `@auxx/database` is mocked to an empty Proxy (see
// [[project-drizzle-columns-undefined-in-vitest]]) — column identity is
// `undefined` there, so any assertion about the predicate would be vacuous.
// Only real SQL can prove a foreign-org row is untouched.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '../errors'
import { updateAgent } from './agent-service'
import { batchUpdateAgentToolsets } from './agent-toolset-service'

// The org cache is Redis-backed and realtime needs a provider — neither is
// available in this harness, and neither is what these tests are about.
vi.mock('../cache', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, onCacheEvent: async () => {} }
})

vi.mock('../realtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getRealtimeService: () => ({ publish: async () => {} }),
    publishAgentUpdated: async () => {},
  }
})

const db = () => getTestDb() as unknown as Database

async function seedAgent(orgId: string, ownerId: string) {
  const [row] = await db()
    .insert(schema.Agent)
    .values({
      organizationId: orgId,
      createdById: ownerId,
      slug: `agent-${orgId.slice(0, 8)}`,
      description: 'original',
      toolsets: [],
      knowledge: [],
      updatedAt: new Date(),
    })
    .returning()
  return row!
}

const readAgent = async (agentId: string) =>
  (await db().select().from(schema.Agent).where(eq(schema.Agent.id, agentId)).limit(1))[0]!

describe('Agent write paths are org-scoped', () => {
  let orgA: Awaited<ReturnType<typeof createTestOrganization>>
  let orgB: Awaited<ReturnType<typeof createTestOrganization>>

  beforeEach(async () => {
    orgA = await createTestOrganization()
    orgB = await createTestOrganization()
  })

  describe('updateAgent', () => {
    it("rejects a foreign org's agent id and leaves the row untouched", async () => {
      const victim = await seedAgent(orgB.id, orgB.ownerId)

      await expect(
        updateAgent(victim.id, orgA.id, { description: 'cross-tenant write' }, {}, db())
      ).rejects.toThrow(NotFoundError)

      const after = await readAgent(victim.id)
      expect(after.description).toBe('original')
      expect(after.organizationId).toBe(orgB.id)
    })

    it('does not leak that the agent exists in another org', async () => {
      const victim = await seedAgent(orgB.id, orgB.ownerId)
      const capture = async (agentId: string): Promise<Error> => {
        try {
          await updateAgent(agentId, orgA.id, { description: 'x' }, {}, db())
        } catch (e) {
          return e as Error
        }
        throw new Error(`expected updateAgent to reject for ${agentId}`)
      }

      const missingId = 'agt_does_not_exist_anywhere'
      const missingErr = await capture(missingId)
      const foreignErr = await capture(victim.id)

      // Same error class and same message shape for "never existed" and
      // "exists, but not yours" — an attacker learns nothing from the response.
      expect(missingErr).toBeInstanceOf(NotFoundError)
      expect(foreignErr).toBeInstanceOf(NotFoundError)
      expect(foreignErr.message.replace(victim.id, '<id>')).toBe(
        missingErr.message.replace(missingId, '<id>')
      )
    })

    it('still updates an agent in the calling org', async () => {
      const own = await seedAgent(orgA.id, orgA.ownerId)

      await updateAgent(own.id, orgA.id, { description: 'updated' }, {}, db())

      expect((await readAgent(own.id)).description).toBe('updated')
    })
  })

  describe('batchUpdateAgentToolsets', () => {
    // `enabledTools` is supplied so `ensureImplicitSnapshots` short-circuits
    // before reaching the (cache-backed) org toolset catalog.
    const patches = [{ slug: 'tickets', enabled: true, enabledTools: [] }]

    it("rejects a foreign org's agent id and leaves the toolsets untouched", async () => {
      const victim = await seedAgent(orgB.id, orgB.ownerId)

      await expect(batchUpdateAgentToolsets(orgA.id, victim.id, patches, {}, db())).rejects.toThrow(
        NotFoundError
      )

      expect((await readAgent(victim.id)).toolsets).toEqual([])
    })

    it('still updates an agent in the calling org', async () => {
      const own = await seedAgent(orgA.id, orgA.ownerId)

      await batchUpdateAgentToolsets(orgA.id, own.id, patches, {}, db())

      const after = await readAgent(own.id)
      expect(after.toolsets.map((t) => t.slug)).toEqual(['tickets'])
      expect(after.toolsets[0]?.enabled).toBe(true)
    })
  })
})
