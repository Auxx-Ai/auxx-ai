// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/__tests__/list-app-blocks.test.ts
//
// Plan 19 Phase A: an empty result is an ANSWER, and the marketplace half of
// that answer is `notInstalled`.
//
// The regression these tests pin is a production turn that spent ~30 of its 30
// iterations rewording a query, because the tool answered "nothing installed
// matches" with `success: false` — which a model can only repair by changing
// its arguments. So the load-bearing assertion in this file is negative and
// exhaustive: NO branch returns `success: false` for an empty result.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolDefinition, AgentToolResult } from '../../../../../agent-framework/types'
import type { GetToolDeps, ToolDeps } from '../../../types'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../../../../workflows/workflow-app-access-guard', () => ({
  assertWorkflowAppNotSystemOwned: vi.fn(async () => {}),
}))

// The shared gate claims the canvas edit lock on every tool call, reads
// included. Unmocked it reaches live Redis and publishes to Pusher; its own
// behaviour is covered by `workflows/graph-edit/__tests__/turn-lock.test.ts`.
vi.mock('../../../../../../workflows/graph-edit/turn-lock', () => ({
  beginWorkflowTurnLock: vi.fn(async () => {}),
}))

/**
 * Installed fleet. The slugs are deliberately skewed against the published
 * catalog below so the exclusion test can tell an ID filter from a slug one:
 *
 * - `appfedex` is installed under slug `fedex-installed`, while the published
 *   row for the same ID carries slug `fedex` — a slug filter would leave it in.
 * - `apphub` is installed under slug `hubspot`, and a DIFFERENT published app
 *   (`apphubspot-v2`) also carries slug `hubspot` — a slug filter would drop it.
 */
const installedApps = vi.fn(async (..._a: unknown[]) => [
  {
    installationId: 'inst-1',
    app: {
      id: 'appfedex',
      slug: 'fedex-installed',
      title: 'Fedex',
      description: null,
      avatarUrl: null,
    },
    orgConnectionPresent: false,
    orgConnectionExpiresAt: null,
    workflowBlocks: [
      {
        id: 'fedex',
        label: 'FedEx',
        description: 'Track FedEx shipments',
        requiresConnection: true,
        ops: [{ key: 'shipment.track', resource: 'shipment', operation: 'track', toolId: 't1' }],
      },
    ],
  },
  {
    installationId: 'inst-2',
    app: { id: 'apphub', slug: 'hubspot', title: 'HubSpot', description: null, avatarUrl: null },
    orgConnectionPresent: true,
    orgConnectionExpiresAt: null,
    workflowBlocks: [],
  },
])

/** The global marketplace cache — no org scope, no DB read. */
const publishedApps = vi.fn(async () => [
  { id: 'appfedex', slug: 'fedex', title: 'Fedex', description: 'Track FedEx shipments' },
  { id: 'apphubspot-v2', slug: 'hubspot', title: 'HubSpot', description: 'CRM' },
  { id: 'appups', slug: 'ups', title: 'UPS', description: 'Track UPS shipments' },
  { id: 'appqb', slug: 'quickbooks', title: 'QuickBooks', description: 'Accounting' },
])

// Replaced rather than spread over `importOriginal`, same as the sibling
// `workflow-authoring-guard.test.ts`: the real cache barrel's module graph takes
// ~9s to load here, which alone blew the 10s `testTimeout` — and a timed-out
// factory leaves the mocked module half-built, so every later test in the file
// then failed with "getCachedInstalledApps is not a function". These two reads
// are the only cache surface anything under test touches; if that stops being
// true, the failure is loud and immediate rather than silent.
vi.mock('../../../../../../cache', () => ({
  getCachedInstalledApps: (...a: unknown[]) => installedApps(...a),
  getCachedPublishedApps: (...a: unknown[]) => publishedApps(...a),
}))

import { createListAppBlocksTool } from '../list-app-blocks'

// ── Fixture ──────────────────────────────────────────────────────────────────

const ORG = 'org-1'
const WF = 'wfapp-1'

const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: WF }] }) }) }),
}

const getDeps: GetToolDeps = () =>
  ({
    db,
    sessionContext: { page: 'workflow.builder', references: [{ kind: 'workflow', id: WF }] },
    organizationId: ORG,
    userId: 'member-1',
    sessionId: 's-1',
    capabilities: {
      can: () => true,
      canViewInstance: () => true,
      assertEditInstance: () => {},
      assertAdminInstance: () => {},
    },
  }) as unknown as ToolDeps

const agentDeps = {
  organizationId: ORG,
  userId: 'member-1',
  sessionId: 's-1',
  turnId: 'turn-1',
} as Parameters<AgentToolDefinition['execute']>[1]

type Output = {
  blocks: Array<Record<string, unknown>>
  notInstalled: Array<{ slug: string; title: string; description: string | null }>
  note: string
}

function run(args: Record<string, unknown> = {}): Promise<AgentToolResult> {
  const tool = createListAppBlocksTool(getDeps)
  return tool.execute(args as never, agentDeps) as Promise<AgentToolResult>
}

async function output(args: Record<string, unknown> = {}): Promise<Output> {
  const result = await run(args)
  expect(result.success).toBe(true)
  return result.output as Output
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('list_app_blocks — empty is an answer', () => {
  it('returns success with an empty blocks list when no app contributes one', async () => {
    installedApps.mockResolvedValueOnce([])

    const result = await run()

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    const out = result.output as Output
    expect(out.blocks).toEqual([])
    // Nothing installed ⇒ the whole catalog is installable.
    expect(out.notInstalled.map((a) => a.slug)).toEqual(['fedex', 'hubspot', 'ups', 'quickbooks'])
    expect(out.note).toContain('No app installed in this workspace contributes a workflow block')
  })

  /**
   * The motivating transcript, in one test: "add a UPS tracking node" in an org
   * that has FedEx but not UPS. The old code returned `Failed: List App Blocks`
   * here and the model rewrote the query 33 times.
   */
  it('surfaces a published-but-uninstalled app when no installed block matches', async () => {
    const out = await output({ query: 'ups' })

    expect(out.blocks).toEqual([])
    expect(out.notInstalled).toEqual([
      { slug: 'ups', title: 'UPS', description: 'Track UPS shipments' },
    ])
    expect(out.note).toContain('"ups"')
    expect(out.note).toContain('notInstalled')
  })

  it('falls back to the full uninstalled list when the query matches nothing at all', async () => {
    const out = await output({ query: 'quantum-blockchain' })

    expect(out.blocks).toEqual([])
    // Not the empty filtered set — "no match for your word, here is everything
    // available" is what ends the retry loop.
    expect(out.notInstalled.map((a) => a.slug)).toEqual(['hubspot', 'ups', 'quickbooks'])
    expect(out.note).toContain('No published app matched "quantum-blockchain"')
    expect(out.note).toContain('complete answer')
  })

  it('is terminal, and says so, when nothing is installed and nothing is installable', async () => {
    publishedApps.mockResolvedValueOnce([
      { id: 'appfedex', slug: 'fedex', title: 'Fedex', description: 'Track FedEx shipments' },
      { id: 'apphub', slug: 'hubspot', title: 'HubSpot', description: 'CRM' },
    ])

    const out = await output({ query: 'quantum-blockchain' })

    expect(out.blocks).toEqual([])
    expect(out.notInstalled).toEqual([])
    expect(out.note).toContain('no app provides this at all')
    expect(out.note).toContain('stop')
  })

  /**
   * The whole point of Phase A. Every shape of empty — no installed apps, no
   * catalog, both, and a query that matches neither — is a successful answer.
   * Only the authorization branch may fail, and that one is covered by
   * `workflow-authoring-guard.test.ts`.
   */
  it('never returns success:false for an empty result, on any branch', async () => {
    const cases: Array<[string, () => void, Record<string, unknown>]> = [
      ['nothing installed', () => installedApps.mockResolvedValueOnce([]), {}],
      ['nothing published', () => publishedApps.mockResolvedValueOnce([]), {}],
      [
        'neither',
        () => {
          installedApps.mockResolvedValueOnce([])
          publishedApps.mockResolvedValueOnce([])
        },
        {},
      ],
      ['unmatchable query', () => {}, { query: 'quantum-blockchain' }],
      [
        'unmatchable query, empty world',
        () => {
          installedApps.mockResolvedValueOnce([])
          publishedApps.mockResolvedValueOnce([])
        },
        { query: 'quantum-blockchain' },
      ],
    ]

    for (const [label, arrange, args] of cases) {
      arrange()
      const result = await run(args)
      expect(result.success, label).toBe(true)
      expect(result.error, label).toBeUndefined()
      const out = result.output as Output
      expect(Array.isArray(out.blocks), label).toBe(true)
      expect(Array.isArray(out.notInstalled), label).toBe(true)
      expect(out.note.length, label).toBeGreaterThan(0)
    }
  })
})

describe('list_app_blocks — notInstalled', () => {
  it('excludes installed apps by ID, not by slug', async () => {
    const out = await output()
    const slugs = out.notInstalled.map((a) => a.slug)

    // `appfedex` is installed (under a different slug) — excluded by ID.
    expect(slugs).not.toContain('fedex')
    // `apphubspot-v2` shares the slug `hubspot` with an installed app but is a
    // different app — a slug filter would have wrongly dropped it.
    expect(slugs).toContain('hubspot')
    expect(slugs).toEqual(['hubspot', 'ups', 'quickbooks'])
  })

  it('carries notInstalled on the non-empty branch too', async () => {
    // "Add UPS and FedEx" with only FedEx installed: surfacing the FedEx block
    // without the UPS offer is half an answer.
    const out = await output({ query: 'track' })

    expect(out.blocks).toHaveLength(1)
    expect(out.blocks[0]).toMatchObject({ type: 'appfedex:fedex', app: 'Fedex' })
    expect(out.notInstalled.map((a) => a.slug)).toEqual(['ups'])
  })

  it('emits only slug, title and description per uninstalled app', async () => {
    const out = await output({ query: 'ups' })
    expect(Object.keys(out.notInstalled[0]!).sort()).toEqual(['description', 'slug', 'title'])
  })

  it('says there is nothing left to install when the catalog is fully installed', async () => {
    publishedApps.mockResolvedValueOnce([
      { id: 'appfedex', slug: 'fedex', title: 'Fedex', description: 'Track FedEx shipments' },
    ])

    const out = await output()

    expect(out.blocks).toHaveLength(1)
    expect(out.notInstalled).toEqual([])
    expect(out.note).toContain('Every published app is already installed')
  })
})

describe('list_app_blocks — digest', () => {
  it('counts the installable apps when there are no blocks to show', () => {
    const digest = createListAppBlocksTool(getDeps).buildDigest?.({
      blocks: [],
      notInstalled: [{ slug: 'ups' }, { slug: 'quickbooks' }],
    })
    expect(digest).toEqual({ label: 'Apps available to install', resultCount: 2 })
  })

  it('counts blocks when there are any', () => {
    const digest = createListAppBlocksTool(getDeps).buildDigest?.({
      blocks: [{ type: 'appfedex:fedex' }],
      notInstalled: [{ slug: 'ups' }],
    })
    expect(digest).toEqual({ label: 'App blocks listed', resultCount: 1 })
  })
})
