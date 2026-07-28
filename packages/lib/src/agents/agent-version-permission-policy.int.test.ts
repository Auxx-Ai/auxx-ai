// packages/lib/src/agents/agent-version-permission-policy.int.test.ts
//
// DB-backed lifecycle tests (vitest.integration.config.ts → auxx_test) for
// `AgentVersion.permissionPolicy` — plan 19 §9 step 3 / §9.1.
//
// Integration rather than db-mocked on purpose: everything asserted here is about
// what actually LANDS in a column and what a subsequent read gets back
// (NOT NULL satisfied, the clamp persisted, `configHash` covering the snapshot,
// restore repointing the draft binding, a grant row on the synthetic member NOT
// widening the published policy). Under the default `vitest.config.ts`
// `@auxx/database` is a Proxy whose columns are `undefined`
// ([[project-drizzle-columns-undefined-in-vitest]]), so a where-clause or column
// assertion there passes vacuously and proves nothing about persistence.
//
// **The org cache is real here, deliberately.** Redis is absent in this harness,
// and `BaseCacheService` falls back to its in-memory layer, so every provider
// (`profiles`, `resources`, `members`, `memberRoleMap`, …) computes straight off
// `auxx_test`. That is what we want: the resource list a publish clamps against
// and the profile rows it resolves from are the real ones, and each test uses a
// fresh org id so nothing is served stale. Do NOT add a `vi.mock('../cache', …)`
// here — it does not intercept the lib-internal imports these modules make
// (same class of problem as the realtime barrel cycle), so it reads as a stub
// that silently isn't applied.
//
// The ONE stub is `getCapabilities`, and it delegates: a user id registered in
// `publisherStubs` gets a synthetic `CapabilityView` (so the author clamp can be
// exercised at an exact rung without standing up grant rows), and every other id
// falls through to the REAL composer.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityView } from '../permissions/capabilities/capability-view'
import { ensureSystemProfiles } from '../permissions/profiles'
import { hashAgentConfig } from './agent-config-snapshot'
import { completeAgentSetup } from './agent-service'
import { publishAgentTx, restoreAgentVersion } from './agent-version-service'

/** userId → the synthetic view the clamp should see. Empty = everyone is real. */
const publisherStubs = new Map<string, CapabilityView>()

vi.mock('../permissions/capabilities/get-capabilities', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../permissions/capabilities/get-capabilities')>()
  return {
    getCapabilities: async (userId: string, orgId: string) =>
      publisherStubs.get(userId) ?? actual.getCapabilities(userId, orgId),
  }
})

const db = () => getTestDb() as unknown as Database

/**
 * A publisher expressed as PREDICATES rather than id lists — the org's real
 * resource list decides which defs exist, so a fixture that named ids would
 * silently stop clamping anything the day the registry changed.
 */
function stubPublisher(rung: 'none' | 'view' | 'edit' | 'admin'): CapabilityView {
  const rank = { none: 0, view: 1, edit: 2, admin: 3 }[rung]
  const view = {
    can: () => rank >= 3,
    has: () => rank >= 3,
    assert: () => {},
    // Areas ride the same rung: 0 = None, 3 = Full (`Level`).
    areaLevel: () => (rank === 0 ? 0 : rank === 1 ? 1 : rank === 2 ? 2 : 3) as never,
    canWriteEntity: () => rank >= 2,
    assertWriteEntity: () => {},
    canEditEntity: () => rank >= 2,
    assertEditEntity: () => {},
    filterEditableDefIds: (ids: string[]) => (rank >= 2 ? ids : []),
    canViewEntity: () => rank >= 1,
    assertViewEntity: () => {},
    filterViewableDefIds: (ids: string[]) => (rank >= 1 ? ids : []),
    viewAccessFor: () => undefined,
    canAdministerDef: () => rank >= 3,
    assertAdministerDef: () => {},
    canViewInstance: () => rank >= 1,
    canEditInstance: () => rank >= 2,
    canAdminInstance: () => rank >= 3,
    assertViewInstance: () => {},
    assertEditInstance: () => {},
    assertAdminInstance: () => {},
  }
  return view as unknown as CapabilityView
}

async function seedSetUpAgent(
  orgId: string,
  ownerId: string,
  kind: 'internal' | 'chat' = 'internal'
) {
  const [row] = await db()
    .insert(schema.Agent)
    .values({
      organizationId: orgId,
      userId: ownerId, // any User id satisfies the FK; identity is not under test
      createdById: ownerId,
      slug: `agent-${Math.random().toString(36).slice(2, 10)}`,
      kind,
      toolsets: [],
      knowledge: [],
      setupCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
  return row!
}

/** A pre-setup draft — no synthetic User, no active version yet. */
async function seedDraftAgent(orgId: string, ownerId: string, kind: 'internal' | 'chat') {
  const [row] = await db()
    .insert(schema.Agent)
    .values({
      organizationId: orgId,
      createdById: ownerId,
      slug: `draft-${Math.random().toString(36).slice(2, 10)}`,
      // `name` is User/`config`-owned, not an Agent column — `completeAgentSetup`
      // falls back to "Untitled agent" for the synthetic User row.
      kind,
      toolsets: [],
      knowledge: [],
      updatedAt: new Date(),
    })
    .returning()
  return row!
}

const profileId = async (orgId: string, slug: string) =>
  (
    await db()
      .select({ id: schema.PermissionProfile.id })
      .from(schema.PermissionProfile)
      .where(
        and(
          eq(schema.PermissionProfile.organizationId, orgId),
          eq(schema.PermissionProfile.slug, slug)
        )
      )
      .limit(1)
  )[0]!.id

const readVersion = async (id: string) =>
  (await db().select().from(schema.AgentVersion).where(eq(schema.AgentVersion.id, id)).limit(1))[0]!

const readAgent = async (id: string) =>
  (await db().select().from(schema.Agent).where(eq(schema.Agent.id, id)).limit(1))[0]!

/**
 * One real record definition from the org's live resource list — the def the
 * per-definition assertions below are written against. Read through the same
 * cached path publish uses, so the test can never assert on a def the clamp
 * never saw. `contact` is preferred because its record base comes from the
 * `records` area with no `ENTITY_BASE_AREAS` override, which keeps the
 * human-side counter-assertions about a def grant honest.
 */
async function aRecordDef(orgId: string) {
  const { getCachedResources } = await import('../cache')
  const { NON_RECORD_DEF_SLUGS } = await import('../permissions/capabilities/entity-access')
  const { ENTITY_BASE_AREAS } = await import('../permissions/capabilities/seat-policy')
  const resources = await getCachedResources(orgId)
  const isPlainRecordDef = (r: (typeof resources)[number]) => {
    const slug = r.entityType ?? r.apiSlug
    return !NON_RECORD_DEF_SLUGS.has(slug) && !ENTITY_BASE_AREAS[slug]
  }
  const def = resources.find((r) => r.entityType === 'contact') ?? resources.find(isPlainRecordDef)
  if (!def) throw new Error('no plain record definition in the org resource list')
  return def
}

const aRecordDefSlug = async (orgId: string) => (await aRecordDef(orgId)).apiSlug

describe('publish snapshots the resolved permission policy', () => {
  let org: Awaited<ReturnType<typeof createTestOrganization>>

  beforeEach(async () => {
    publisherStubs.clear()
    org = await createTestOrganization()
    await ensureSystemProfiles(org.id, db())
    publisherStubs.set(org.ownerId, stubPublisher('admin'))
  })

  it('writes a NON-NULL, total policy for an internal agent on the permissive agent profile', async () => {
    const agent = await seedSetUpAgent(org.id, org.ownerId)

    const { version } = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )

    const stored = await readVersion(version.id)
    expect(stored.permissionPolicy).not.toBeNull()
    expect(stored.permissionPolicy.areas.default).toBe('admin')
    expect(stored.permissionPolicy.definitions.default).toBe('admin')
    expect(stored.permissionPolicy.sourceProfileId).toBe(await profileId(org.id, 'agent'))
    expect(stored.permissionPolicy.publishedByUserId).toBe(org.ownerId)
    // Total, not sparse: every current record def is materialized as an override
    // so the snapshot stays executable after the profile changes.
    expect(stored.permissionPolicy.definitions.overrides[await aRecordDefSlug(org.id)]).toBe(
      'admin'
    )
  })

  it('starts a chat agent on the fail-closed chat_agent profile (§18)', async () => {
    const agent = await seedSetUpAgent(org.id, org.ownerId, 'chat')
    await db()
      .update(schema.Agent)
      .set({ permissionProfileId: await profileId(org.id, 'chat_agent') })
      .where(eq(schema.Agent.id, agent.id))

    const { version } = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )

    const stored = await readVersion(version.id)
    expect(stored.permissionPolicy.areas.default).toBe('none')
    expect(stored.permissionPolicy.definitions.default).toBe('none')
    // Every registered resource type is materialized at publish, each one at the
    // rung its own area supplied — all `none` on this fail-closed profile.
    expect(stored.permissionPolicy.resources.kb?.default).toBe('none')
    expect(stored.permissionPolicy.resources.dataset?.default).toBe('none')
  })

  it('includes the policy in configHash, so the stored hash matches a recompute', async () => {
    const agent = await seedSetUpAgent(org.id, org.ownerId)
    const { version } = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )
    const stored = await readVersion(version.id)
    expect(stored.configHash).toBe(hashAgentConfig(stored))
    // …and a hash that IGNORED the policy would differ.
    expect(stored.configHash).not.toBe(hashAgentConfig({ ...stored, permissionPolicy: null }))
  })

  it('does not copy the profile binding onto the synthetic OrganizationMember (§0.16/§17)', async () => {
    const agent = await seedSetUpAgent(org.id, org.ownerId)
    await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )

    const [member] = await db()
      .select({ permissionProfileId: schema.OrganizationMember.permissionProfileId })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, org.id),
          eq(schema.OrganizationMember.userId, agent.userId!)
        )
      )
      .limit(1)
    // The member row carries membership/role/seat only — never agent policy.
    if (member) expect(member.permissionProfileId).toBeNull()
  })
})

describe('completeAgentSetup publishes v1 (§9.1 chat-agent setup)', () => {
  let org: Awaited<ReturnType<typeof createTestOrganization>>

  beforeEach(async () => {
    publisherStubs.clear()
    org = await createTestOrganization()
    await ensureSystemProfiles(org.id, db())
    publisherStubs.set(org.ownerId, stubPublisher('admin'))
  })

  it('publishes the chat_agent policy as v1 without binding a profile to the synthetic member', async () => {
    const agent = await seedDraftAgent(org.id, org.ownerId, 'chat')

    await completeAgentSetup(agent.id, org.id, db(), {
      force: true,
      completedByUserId: org.ownerId,
    })

    const after = await readAgent(agent.id)
    expect(after.setupCompletedAt).not.toBeNull()
    expect(after.activeVersionId).not.toBeNull()
    // The draft binding is still null — the policy came from the KIND template.
    expect(after.permissionProfileId).toBeNull()

    const v1 = await readVersion(after.activeVersionId!)
    expect(v1.versionNumber).toBe(1)
    expect(v1.permissionPolicy.definitions.default).toBe('none')
    expect(v1.permissionPolicy.areas.default).toBe('none')
    expect(v1.permissionPolicy.sourceProfileId).toBe(await profileId(org.id, 'chat_agent'))
    expect(v1.permissionPolicy.publishedByUserId).toBe(org.ownerId)

    // The synthetic member minted in the same transaction carries NO binding.
    const [member] = await db()
      .select({
        permissionProfileId: schema.OrganizationMember.permissionProfileId,
        role: schema.OrganizationMember.role,
      })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, org.id),
          eq(schema.OrganizationMember.userId, after.userId!)
        )
      )
      .limit(1)
    expect(member?.permissionProfileId).toBeNull()
    expect(member?.role).toBe('USER')
  })

  it('publishes the permissive internal-agent policy for a kind:internal draft', async () => {
    const agent = await seedDraftAgent(org.id, org.ownerId, 'internal')

    await completeAgentSetup(agent.id, org.id, db(), {
      force: true,
      completedByUserId: org.ownerId,
    })

    const v1 = await readVersion((await readAgent(agent.id)).activeVersionId!)
    expect(v1.permissionPolicy.definitions.default).toBe('admin')
    expect(v1.permissionPolicy.sourceProfileId).toBe(await profileId(org.id, 'agent'))
  })

  it('clamps the auto-published v1 by the human who completed setup (§2.4a)', async () => {
    const reader = await createTestUser({ name: 'Read-only author' })
    publisherStubs.set(reader.id, stubPublisher('view'))
    const agent = await seedDraftAgent(org.id, org.ownerId, 'internal')

    await completeAgentSetup(agent.id, org.id, db(), {
      force: true,
      completedByUserId: reader.id,
    })

    const v1 = await readVersion((await readAgent(agent.id)).activeVersionId!)
    // The all-Full `agent` profile, reduced to what its author holds.
    expect(v1.permissionPolicy.definitions.default).toBe('view')
    expect(v1.permissionPolicy.definitions.overrides[await aRecordDefSlug(org.id)]).toBe('view')
    expect(v1.permissionPolicy.publishedByUserId).toBe(reader.id)
    expect(v1.permissionPolicy.clamp.length).toBeGreaterThan(0)
  })
})

describe('the author clamp is persisted, not merely computed (§2.4a / §9.1)', () => {
  let org: Awaited<ReturnType<typeof createTestOrganization>>
  let defSlug: string

  beforeEach(async () => {
    publisherStubs.clear()
    org = await createTestOrganization()
    await ensureSystemProfiles(org.id, db())
    defSlug = await aRecordDefSlug(org.id)
  })

  it('a records:Read publisher on the all-Full agent profile yields a Read-clamped snapshot', async () => {
    publisherStubs.set(org.ownerId, stubPublisher('view'))
    const agent = await seedSetUpAgent(org.id, org.ownerId)

    const { version, reductions } = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )

    const stored = await readVersion(version.id)
    expect(stored.permissionPolicy.definitions.overrides[defSlug]).toBe('view')
    expect(stored.permissionPolicy.definitions.default).toBe('view')
    // Every materialized def is clamped, not just the one we sampled.
    expect(
      Object.values(stored.permissionPolicy.definitions.overrides).filter((l) => l !== 'view')
    ).toEqual([])
    expect(stored.permissionPolicy.areas.default).toBe('view')
    // The reduction record survives the round-trip, so an audit can read it.
    expect(stored.permissionPolicy.clamp.length).toBeGreaterThan(0)
    expect(reductions.length).toBe(stored.permissionPolicy.clamp.length)
  })

  it('the SAME publish by an admin yields Full', async () => {
    publisherStubs.set(org.ownerId, stubPublisher('admin'))
    const agent = await seedSetUpAgent(org.id, org.ownerId)

    const { version, reductions } = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )

    const stored = await readVersion(version.id)
    expect(stored.permissionPolicy.definitions.overrides[defSlug]).toBe('admin')
    expect(stored.permissionPolicy.definitions.default).toBe('admin')
    expect(reductions).toEqual([])
    expect(stored.permissionPolicy.clamp).toEqual([])
  })

  it('republishing after a demotion re-clamps DOWN and mints a new version', async () => {
    publisherStubs.set(org.ownerId, stubPublisher('admin'))
    const agent = await seedSetUpAgent(org.id, org.ownerId)

    const first = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )
    expect(
      (await readVersion(first.version.id)).permissionPolicy.definitions.overrides[defSlug]
    ).toBe('admin')

    // The publisher is demoted, then republishes the same unchanged draft.
    publisherStubs.set(org.ownerId, stubPublisher('view'))
    const second = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )

    // NOT a no-op republish: the authority genuinely changed, so the hash did too.
    expect(second.version.id).not.toBe(first.version.id)
    expect(second.version.versionNumber).toBe(first.version.versionNumber + 1)
    expect(
      (await readVersion(second.version.id)).permissionPolicy.definitions.overrides[defSlug]
    ).toBe('view')
    // The OLD snapshot is untouched — a demotion must not rewrite history.
    expect(
      (await readVersion(first.version.id)).permissionPolicy.definitions.overrides[defSlug]
    ).toBe('admin')
  })

  it('an unchanged republish by the SAME publisher is still a no-op', async () => {
    publisherStubs.set(org.ownerId, stubPublisher('admin'))
    const agent = await seedSetUpAgent(org.id, org.ownerId)

    const first = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )
    const second = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )

    expect(second.version.id).toBe(first.version.id)
    expect(second.reductions).toEqual([])
  })
})

describe('the published policy is the ONLY agent authority (§9.1 add-then-remove)', () => {
  let org: Awaited<ReturnType<typeof createTestOrganization>>

  beforeEach(async () => {
    publisherStubs.clear()
    org = await createTestOrganization()
    await ensureSystemProfiles(org.id, db())
    publisherStubs.set(org.ownerId, stubPublisher('admin'))
  })

  it('a grant row on the synthetic member does not widen a definition republished as None', async () => {
    const { resolveAgentRunCapabilities } = await import(
      '../ai/agent-framework/agent-run-capabilities'
    )
    const def = await aRecordDef(org.id)

    // The agent gets its own synthetic User + member row, and v1 at all-Full.
    const draft = await seedDraftAgent(org.id, org.ownerId, 'internal')
    await completeAgentSetup(draft.id, org.id, db(), {
      force: true,
      completedByUserId: org.ownerId,
    })
    const withV1 = await readAgent(draft.id)
    const v1 = await readVersion(withV1.activeVersionId!)
    expect(v1.permissionPolicy.definitions.overrides[def.apiSlug]).toBe('admin')

    const asAgent = async (policyRow: typeof v1) =>
      (await resolveAgentRunCapabilities({
        agent: {
          userId: withV1.userId,
          runAsUserId: null,
          id: withV1.id,
          permissionPolicy: policyRow.permissionPolicy,
        },
        organizationId: org.id,
      }))!

    expect((await asAgent(v1)).canEditEntity(def.entityDefinitionId)).toBe(true)

    // Now REPUBLISH the same agent on the fail-closed profile…
    await db()
      .update(schema.Agent)
      .set({ permissionProfileId: await profileId(org.id, 'chat_agent') })
      .where(eq(schema.Agent.id, draft.id))
    // …while writing an `admin` type-level grant onto the agent's OWN synthetic
    // member. Under the shipped additive model that row was the agent's
    // authority; under §2.3 it must be inert.
    await db().insert(schema.ResourceAccess).values({
      organizationId: org.id,
      entityDefinitionId: def.entityDefinitionId,
      granteeType: 'user',
      granteeId: withV1.userId!,
      permission: 'admin',
      updatedAt: new Date(),
    })

    const { version: v2 } = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: draft.id,
        publishedByUserId: org.ownerId,
      })
    )
    const stored2 = await readVersion(v2.id)
    expect(stored2.permissionPolicy.definitions.overrides[def.apiSlug]).toBe('none')

    const capsV2 = await asAgent(stored2)
    expect(capsV2.canViewEntity(def.entityDefinitionId)).toBe(false)
    expect(capsV2.canEditEntity(def.entityDefinitionId)).toBe(false)
    expect(capsV2.canAdministerDef(def.entityDefinitionId)).toBe(false)

    // The grant row is REAL, not a no-op fixture: composed for a human member it
    // does confer admin on that def. Without this the assertion above could pass
    // for the wrong reason.
    const human = await createTestUser({ name: 'Human grantee' })
    await db().insert(schema.OrganizationMember).values({
      userId: human.id,
      organizationId: org.id,
      role: 'USER',
      status: 'ACTIVE',
      updatedAt: new Date(),
    })
    await db().insert(schema.ResourceAccess).values({
      organizationId: org.id,
      entityDefinitionId: def.entityDefinitionId,
      granteeType: 'user',
      granteeId: human.id,
      permission: 'admin',
      updatedAt: new Date(),
    })
    // The org cache is real and in-memory here, so rows written mid-test are not
    // visible to an already-computed key (`memberRoleMap`, `restrictedEntityDefIds`).
    // Flush before composing the human — this is a fixture concern, not an
    // invalidation assertion.
    const { flushOrganization } = await import('../cache')
    await flushOrganization(org.id)

    const { getCapabilities } = await import('../permissions/capabilities/get-capabilities')
    const humanCaps = await getCapabilities(human.id, org.id)
    expect(humanCaps.canViewEntity(def.entityDefinitionId)).toBe(true)
  })

  it('an OWNER run-as cannot lift a definition published as None', async () => {
    const { resolveAgentRunCapabilities } = await import(
      '../ai/agent-framework/agent-run-capabilities'
    )
    const def = await aRecordDef(org.id)

    // A real OWNER member to delegate to.
    const owner = await createTestUser({ name: 'Org owner' })
    await db().insert(schema.OrganizationMember).values({
      userId: owner.id,
      organizationId: org.id,
      role: 'OWNER',
      status: 'ACTIVE',
      updatedAt: new Date(),
    })

    const draft = await seedDraftAgent(org.id, org.ownerId, 'chat')
    await completeAgentSetup(draft.id, org.id, db(), {
      force: true,
      completedByUserId: org.ownerId,
    })
    const agent = await readAgent(draft.id)
    const v1 = await readVersion(agent.activeVersionId!)
    expect(v1.permissionPolicy.definitions.default).toBe('none')

    const caps = (await resolveAgentRunCapabilities({
      agent: {
        userId: agent.userId,
        runAsUserId: owner.id,
        id: agent.id,
        permissionPolicy: v1.permissionPolicy,
      },
      organizationId: org.id,
    }))!

    expect(caps.canViewEntity(def.entityDefinitionId)).toBe(false)
    expect(caps.canEditEntity(def.entityDefinitionId)).toBe(false)

    // The delegate really is an unrestricted OWNER — so the denial above is the
    // published `None` talking, not a broken run-as resolution.
    const { getCapabilities } = await import('../permissions/capabilities/get-capabilities')
    const ownerCaps = await getCapabilities(owner.id, org.id)
    expect(ownerCaps.canViewEntity(def.entityDefinitionId)).toBe(true)
    expect(ownerCaps.canEditEntity(def.entityDefinitionId)).toBe(true)
  })
})

describe('resolveVersionPolicy — the pinned-eval read (§15)', () => {
  let org: Awaited<ReturnType<typeof createTestOrganization>>

  beforeEach(async () => {
    publisherStubs.clear()
    org = await createTestOrganization()
    await ensureSystemProfiles(org.id, db())
    publisherStubs.set(org.ownerId, stubPublisher('admin'))
  })

  it('returns the PINNED version’s policy, not the agent’s current active one', async () => {
    const { resolveVersionPolicy } = await import('./agent-permission-policy')
    const agent = await seedSetUpAgent(org.id, org.ownerId)

    // v1 permissive, v2 fail-closed — the two must stay independently readable.
    const v1 = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )
    await db()
      .update(schema.Agent)
      .set({ permissionProfileId: await profileId(org.id, 'chat_agent') })
      .where(eq(schema.Agent.id, agent.id))
    const v2 = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )

    expect((await resolveVersionPolicy(org.id, v1.version.id, db()))?.definitions.default).toBe(
      'admin'
    )
    expect((await resolveVersionPolicy(org.id, v2.version.id, db()))?.definitions.default).toBe(
      'none'
    )
    // …and the agent's active version is v2, so a resolver that ignored the
    // pinned id would have answered 'none' for both.
    expect((await readAgent(agent.id)).activeVersionId).toBe(v2.version.id)
  })

  it('returns null for a version id belonging to another org', async () => {
    const { resolveVersionPolicy } = await import('./agent-permission-policy')
    const other = await createTestOrganization()
    await ensureSystemProfiles(other.id, db())
    publisherStubs.set(other.ownerId, stubPublisher('admin'))

    const foreignAgent = await seedSetUpAgent(other.id, other.ownerId)
    const foreignVersion = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: other.id,
        agentId: foreignAgent.id,
        publishedByUserId: other.ownerId,
      })
    )

    // The row exists — it is the ORG predicate that must refuse it.
    expect(await readVersion(foreignVersion.version.id)).toBeDefined()
    expect(await resolveVersionPolicy(org.id, foreignVersion.version.id, db())).toBeNull()
  })
})

describe('restore restores that version’s policy binding (§14)', () => {
  let org: Awaited<ReturnType<typeof createTestOrganization>>

  beforeEach(async () => {
    publisherStubs.clear()
    org = await createTestOrganization()
    await ensureSystemProfiles(org.id, db())
    publisherStubs.set(org.ownerId, stubPublisher('admin'))
  })

  it('repoints the draft binding at the restored version’s source profile, and marks dirty', async () => {
    const agent = await seedSetUpAgent(org.id, org.ownerId)
    const agentProfile = await profileId(org.id, 'agent')
    const chatProfile = await profileId(org.id, 'chat_agent')

    // v1 on the permissive `agent` profile.
    await db()
      .update(schema.Agent)
      .set({ permissionProfileId: agentProfile })
      .where(eq(schema.Agent.id, agent.id))
    const v1 = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )

    // v2 on the fail-closed `chat_agent` profile.
    await db()
      .update(schema.Agent)
      .set({ permissionProfileId: chatProfile })
      .where(eq(schema.Agent.id, agent.id))
    const v2 = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )
    expect((await readVersion(v2.version.id)).permissionPolicy.definitions.default).toBe('none')
    expect((await readAgent(agent.id)).permissionProfileId).toBe(chatProfile)

    // Restore v1.
    const restored = await restoreAgentVersion({
      organizationId: org.id,
      agentId: agent.id,
      toVersionId: v1.version.id,
    })
    expect(restored.isOk()).toBe(true)

    const after = await readAgent(agent.id)
    expect(after.permissionProfileId).toBe(agentProfile)
    // The authority differs from the still-active v2, so the draft is dirty.
    expect(after.hasUnpublishedChanges).toBe(true)
    // `activeVersionId` is NOT touched — nothing goes live until publish.
    expect(after.activeVersionId).toBe(v2.version.id)

    // Republishing the restored draft reproduces v1's authority.
    const v3 = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )
    expect((await readVersion(v3.version.id)).permissionPolicy.definitions.default).toBe('admin')
  })

  it('leaves both snapshots byte-identical after the restore', async () => {
    const agent = await seedSetUpAgent(org.id, org.ownerId)
    const v1 = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )
    const before = await readVersion(v1.version.id)

    await restoreAgentVersion({
      organizationId: org.id,
      agentId: agent.id,
      toVersionId: v1.version.id,
    })

    const after = await readVersion(v1.version.id)
    expect(after.permissionPolicy).toEqual(before.permissionPolicy)
    expect(after.configHash).toBe(before.configHash)
  })

  it('ignores a sourceProfileId from a FOREIGN org rather than binding across tenants', async () => {
    const other = await createTestOrganization()
    await ensureSystemProfiles(other.id, db())

    const agent = await seedSetUpAgent(org.id, org.ownerId)
    const v1 = await db().transaction((tx) =>
      publishAgentTx(tx, {
        organizationId: org.id,
        agentId: agent.id,
        publishedByUserId: org.ownerId,
      })
    )

    // Rewrite the snapshot's audit pointer at another org's profile.
    const foreign = await profileId(other.id, 'agent')
    const stored = await readVersion(v1.version.id)
    await db()
      .update(schema.AgentVersion)
      .set({ permissionPolicy: { ...stored.permissionPolicy, sourceProfileId: foreign } })
      .where(eq(schema.AgentVersion.id, v1.version.id))

    const boundBefore = (await readAgent(agent.id)).permissionProfileId
    await restoreAgentVersion({
      organizationId: org.id,
      agentId: agent.id,
      toVersionId: v1.version.id,
    })

    expect((await readAgent(agent.id)).permissionProfileId).toBe(boundBefore)
  })
})
