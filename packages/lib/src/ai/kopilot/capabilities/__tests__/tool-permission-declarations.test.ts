// packages/lib/src/ai/kopilot/capabilities/__tests__/tool-permission-declarations.test.ts
//
// Plan 19 step 5 / 19b G9 — the anti-rot test for the agent tool permission audit.
//
// WHAT THIS PROVES
//   1. Every tool registered through a native capability factory carries an
//      `AgentToolPermission`. Fully static, non-negotiable: a new tool cannot
//      reach the registry without stating its authorization contract.
//   2. Each declaration is well-formed for its own target (an `instance` names
//      real InstanceAccessKeys, an `area` names a real Area, an `unenforced`
//      one carries a rationale). The type says most of this at compile time;
//      this catches tools built at RUNTIME from external data — the app bridge
//      and the MCP adapter — where the compiler never sees a literal.
//   3. The known-gap set is EXACTLY pinned, both ways. A tool that starts
//      declaring `enforcement: 'unenforced'` without being added below fails.
//      A tool that gets FIXED and flips to `'enforced'` while still listed
//      below also fails. That is the whole point: 19b's ranked gap list was
//      prose in a plan document and started rotting the next PR; here it is a
//      list the suite forces you to maintain.
//   4. The `target: 'none'` set is pinned the same way — `'none'` is the value
//      a careless author reaches for, so it may not grow silently.
//
// WHAT THIS DOES **NOT** PROVE
//   That a declaration of `enforcement: 'enforced'` corresponds to a real
//   assertion inside `execute`. That is not statically decidable, and a regex
//   over the tool's source ("does it mention canViewEntity?") would manufacture
//   confidence rather than earn it — a tool can read the capability view and
//   ignore the answer. The honest substitute is the curated partition in (3):
//   the enforced set is a human-reviewed claim, and the suite's job is to make
//   any change to that claim explicit and reviewable instead of silent.
//
//   Behavioural proof exists for exactly one family today: the 17
//   `agents.builder` tools, whose gate is exercised per tool in
//   `agents-builder/tools/__tests__/agent-authoring-guard.test.ts`. Extending
//   that pattern per domain is the way to convert claims in (3) into proofs.
//
// Enumeration mirrors `agent-authoring-guard.test.ts`: build the capability
// factories, read `capability.tools`, and assert over the whole set — never per
// file. A per-file test is exactly how six unguarded builder tools shipped.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isInstanceAccessKey } from '../../../../permissions/capabilities/instance-access'
import { Area } from '../../../../permissions/capabilities/registry'
import type { AgentToolDefinition } from '../../../agent-framework/types'
import type { GetToolDeps, PageCapability } from '../types'

// The agents-builder factory is the only async/IO-touching one: it reads the
// session agent, the org toolset catalog, and the agent's procedures to decide
// which tools to register. Stubbed to the `internal` branch so the enumeration
// covers the FULL 17-tool set (a `chat`-kind agent registers 15).
const { getCachedAgentById } = vi.hoisted(() => ({
  getCachedAgentById: vi.fn(async () => ({ id: 'a1', kind: 'internal' }) as never),
}))

vi.mock('../../../../cache', () => ({
  getCachedAgentById,
  onCacheEvent: vi.fn(async () => {}),
}))
vi.mock('../../../../agents/procedures/authoring', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listAgentProceduresForAuthoring: vi.fn(async () => ({ match: () => [] })),
}))
vi.mock('../../../../agents/toolset-catalog', () => ({
  getOrgToolsetCatalog: vi.fn(async () => []),
  getOrgToolsetCatalogForSurface: vi.fn(async () => []),
}))

import { createActorCapabilities } from '../actors'
import {
  createAgentsBuilderCapabilities,
  createSuggestRepliesGlobalCapability,
} from '../agents-builder'
import { createEntityCapabilities } from '../entities'
import { createKbCapabilities, createKbReadCapabilities } from '../kb'
import { createKnowledgeCapabilities } from '../knowledge'
import { createKopilotCapabilities } from '../kopilot'
import { createLearnedKbCapabilities } from '../learned'
import { createMailCapabilities } from '../mail'
import { createRecordViewCapabilities } from '../record-views'
import { createCapabilityRegistry } from '../registry'
import { createTaskCapabilities } from '../tasks'
import { createNativeWorkflowCapabilities } from '../workflow'
import { createWorkflowBuilderCapabilities } from '../workflow-builder'

const ORG = 'org-1'

// Tool factories capture `getDeps` for execute-time use only; construction never
// calls it — except the builder factory, which reads `sessionContext` to resolve
// the agent under edit.
const getDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: { page: 'agents.builder', references: [{ kind: 'agent', id: 'a1' }] },
    organizationId: ORG,
    userId: 'member-1',
    sessionId: 's-1',
    capabilities: undefined,
  }) as never

/**
 * Every native capability factory the production registries assemble
 * (`apps/web/.../api/kopilot/stream/route.ts`, `chat/agent/build-chat-engine-config.ts`,
 * `ai/agent-framework/effective-runtime.ts`, the three `approvals/*` runners,
 * `workflow-engine/nodes/action-nodes/ai-v2.ts`). App- and MCP-backed bridges are
 * built from live org data and are covered by their own case below.
 */
async function collectNativeCapabilities(): Promise<PageCapability[]> {
  return [
    createEntityCapabilities(getDeps),
    createMailCapabilities(getDeps),
    createKnowledgeCapabilities(getDeps),
    createActorCapabilities(getDeps),
    createTaskCapabilities(getDeps),
    createKopilotCapabilities(getDeps),
    createKbCapabilities(getDeps),
    createKbReadCapabilities(getDeps),
    createLearnedKbCapabilities(getDeps),
    createRecordViewCapabilities(getDeps),
    createNativeWorkflowCapabilities(getDeps),
    createWorkflowBuilderCapabilities(getDeps),
    createSuggestRepliesGlobalCapability(getDeps),
    await createAgentsBuilderCapabilities(getDeps, ORG),
  ]
}

/** Flatten every registered native tool, deduped by name. */
async function collectNativeTools(): Promise<AgentToolDefinition[]> {
  const byName = new Map<string, AgentToolDefinition>()
  for (const capability of await collectNativeCapabilities()) {
    for (const tool of capability.tools) byName.set(tool.name, tool)
  }
  return [...byName.values()]
}

/**
 * Tools whose declared requirement is NOT asserted by their `execute` today.
 *
 * This list is the machine-readable form of 19b's ranked gaps. Each entry names
 * the gap family; the tool's own `permission.note` carries the detail.
 *
 * TO ADD an entry you must be adding a tool that knowingly skips authorization —
 * say why in its `note`, and expect the reviewer to ask.
 * TO REMOVE one, land the assertion in `execute`, flip the declaration to
 * `enforcement: 'enforced'`, and delete the line here. The test fails if you do
 * either half without the other.
 */
const KNOWN_UNENFORCED: readonly string[] = [
  // 19b G3 is GONE from this list: `create_note` was the pair's last survivor and
  // it now enforces (`CommentService` asserts `commentsManage` plus parent view,
  // with thread hosts branching to inbox view + the mail lens — plan 41).
  // 19b G7 — the residue of the coarse org-wide reads. `list_table_views` and
  // `list_tags` are GONE from this list: both found a real rung (the page's def /
  // the `tag` def) and now assert `canViewEntity`. These two did not, and the
  // reason is a MODEL gap, not an oversight:
  //   - `list_members` / `list_groups` — `Area.members` is a Full-only ladder about
  //     *managing* members (`rungs: [{ level: Full, keys: [membersManage] }]`).
  //     There is no read rung, so a name→actorId lookup has nothing to assert
  //     against; forcing `membersManage` would demand Full manage authority for a
  //     directory read. Both were NARROWED instead (see their `permission.note`) —
  //     notably `list_groups` no longer leaks `visibility: 'private'` groups.
  //   - `list_tasks` — tasks are neither an `Area` nor an entity definition.
  // The fix for all three is a `directory` / `tasks` area decision, not a tool edit.
  'list_members',
  'list_groups',
  'list_tasks',
  // Ungated task write; no Area or definition exists to assert against, and the
  // human `task.create` router is ungated too.
  'create_task',
  // 19b G2 — mail sits outside the four-level model entirely.
  'start_new_conversation',
]

/**
 * Tools that genuinely require no authorization: agent-loop plumbing writing
 * turn-local state, or a read of public data. Pinned so `'none'` cannot become
 * the lazy default for a tool that actually touches workspace data.
 */
const NO_AUTHORIZATION_REQUIRED: readonly string[] = [
  'plan_create',
  'plan_update_step',
  'assign_variable',
  'suggest_replies',
  'search_docs',
  // workflow.builder discovery — static product data (the node-type registry
  // and the public template gallery), identical for every org. Everything that
  // touches the workflow itself routes through `resolveWorkflowAuthoring`.
  'list_node_types',
  'describe_node_type',
  'find_workflow_templates',
]

const AREA_SLUGS = new Set<string>(Object.values(Area))
const UNMODELED_DOMAINS = new Set(['mail', 'tasks', 'directory'])

describe('agent tool permission declarations — registry enumeration', () => {
  beforeEach(() => {
    getCachedAgentById.mockClear()
  })

  it('enumerates the full native tool surface', async () => {
    const tools = await collectNativeTools()
    // Guards against a broken mock silently enumerating an empty registry and
    // making every assertion below pass vacuously.
    expect(tools.length).toBeGreaterThanOrEqual(60)
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length)
  })

  it('EVERY registered native tool declares a permission', async () => {
    const undeclared = (await collectNativeTools())
      .filter((t) => !t.permission)
      .map((t) => t.name)
      .sort()
    expect(undeclared).toEqual([])
  })

  it('every declaration is well-formed for its target', async () => {
    for (const tool of await collectNativeTools()) {
      const permission = tool.permission
      if (!permission) continue
      switch (permission.target) {
        case 'definition':
          expect(permission.level, tool.name).toBeTruthy()
          break
        case 'instance':
          expect(permission.keys.length, tool.name).toBeGreaterThan(0)
          for (const key of permission.keys) {
            expect(isInstanceAccessKey(key), `${tool.name}: ${key}`).toBe(true)
          }
          break
        case 'area':
          expect(AREA_SLUGS.has(permission.area), `${tool.name}: ${permission.area}`).toBe(true)
          break
        case 'unmodeled':
          expect(
            UNMODELED_DOMAINS.has(permission.domain),
            `${tool.name}: ${permission.domain}`
          ).toBe(true)
          break
        default:
          expect(permission.note?.length, tool.name).toBeGreaterThan(0)
      }
      // A gap must always explain itself — the note is what a reader gets
      // instead of re-deriving the sweep.
      if ('enforcement' in permission && permission.enforcement === 'unenforced') {
        expect(permission.note.length, tool.name).toBeGreaterThan(0)
      }
    }
  })

  it('the unenforced set is EXACTLY the curated known-gap list', async () => {
    const declared = (await collectNativeTools())
      .filter((t) => t.permission && 'enforcement' in t.permission)
      .filter((t) => (t.permission as { enforcement: string }).enforcement === 'unenforced')
      .map((t) => t.name)
      .sort()
    expect(declared).toEqual([...KNOWN_UNENFORCED].sort())
  })

  it('the no-authorization-required set is EXACTLY the curated plumbing list', async () => {
    const declared = (await collectNativeTools())
      .filter((t) => t.permission?.target === 'none')
      .map((t) => t.name)
      .sort()
    expect(declared).toEqual([...NO_AUTHORIZATION_REQUIRED].sort())
  })

  it('no native tool declares itself a bridge — `bridge` is app/MCP only', async () => {
    const bridges = (await collectNativeTools())
      .filter((t) => t.permission?.target === 'bridge')
      .map((t) => t.name)
    expect(bridges).toEqual([])
  })

  it('every tool reachable through a real registry declares a permission', async () => {
    const registry = createCapabilityRegistry()
    for (const capability of await collectNativeCapabilities()) registry.register(capability)

    const seen = new Set<string>()
    for (const page of [...registry.getPages(), 'some.unregistered.page']) {
      for (const tool of registry.getTools(page)) {
        seen.add(tool.name)
        expect(tool.permission, `${page}/${tool.name}`).toBeDefined()
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(60)
  })
})
