// packages/lib/src/workflows/graph-edit/__tests__/manifest-lookup.test.ts

/**
 * The threaded `ManifestLookup` (plan 17 PR B2).
 *
 * Every assertion here is a PAIR: the same graph judged with the core registry
 * alone, and with a lookup that also resolves an installed app's block. The
 * pair is the point — each of these sites used to read `getManifest` directly,
 * so the app-block column is what threading the lookup bought, and the
 * core-only column is the regression guard that core types did not shift.
 */

import { describe, expect, it, vi } from 'vitest'
import type { CachedInstalledApp, CachedWorkflowBlock } from '../../../cache/org-cache-keys'

// Partial mock — `read.ts` pulls the cache barrel in through its module graph.
// Nothing here reads the cache; the lookups are built by hand.
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedInstalledApps: async () => [],
}))

const { buildGraphSummary } = await import('../read')

import { synthesizeAppBlockManifest } from '../../../workflow-engine/catalog/app-manifests'
import { getManifest } from '../../../workflow-engine/catalog/registry'
import type { ManifestLookup } from '../../../workflow-engine/catalog/types'
import { resolveConnectionSpec } from '../normalize/connection'
import type { DraftGraph, GraphNode } from '../types'
import { isInputNodePair, validateGraphStructure, validateNodeConfigs } from '../validate'

const APP_ID = 'z3prnwpd3rt31mp7f9yxo5m6'
const APP_TYPE = `${APP_ID}:fedex`
const BLOCK_ID = 'fedex-DmJuCD8M2cAE0Hqdua0Ns'
const MANUAL_ID = 'manual-aaaaaaaaaaaaaaaaaaa'
const FORM_ID = 'form-input-aaaaaaaaaaaaaaa'

const installation = {
  installationId: 'inst_1',
  installationType: 'production',
  installedAt: '2026-08-01T00:00:00.000Z',
  app: {
    id: APP_ID,
    slug: 'fedex',
    title: 'FedEx',
    description: null,
    avatarUrl: null,
    category: null,
  },
  currentDeployment: null,
  methods: [],
  connectionDefinitions: {},
  orgConnectionPresent: true,
  orgConnectionExpiresAt: null,
} as CachedInstalledApp

const block: CachedWorkflowBlock = {
  id: 'fedex',
  label: 'FedEx',
  iconKey: null,
  inputsJsonSchema: {},
  toolMap: { 'shipment.track': 'tool_track' },
  refs: [],
  ops: [
    {
      key: 'shipment.track',
      resource: 'shipment',
      operation: 'track',
      toolId: 'tool_track',
      inputsJsonSchema: {},
      outputsJsonSchema: {},
      requiresConnection: true,
    },
  ],
}

/** The core registry alone — what every one of these sites used to read. */
const coreOnly: ManifestLookup = getManifest

/** Core registry ∪ one installed app's block — what `buildManifestLookup` returns. */
const withApp: ManifestLookup = (type) =>
  getManifest(type) ??
  (type === APP_TYPE ? synthesizeAppBlockManifest(installation, block) : undefined)

function appBlockNode(data: Record<string, unknown> = {}): GraphNode {
  return {
    id: BLOCK_ID,
    type: 'standard',
    position: { x: 0, y: 0 },
    data: {
      id: BLOCK_ID,
      type: APP_TYPE,
      title: 'FedEx',
      appId: APP_ID,
      blockId: 'fedex',
      resource: 'shipment',
      operation: 'track',
      ...data,
    },
  }
}

function manualNode(): GraphNode {
  return {
    id: MANUAL_ID,
    type: 'standard',
    position: { x: 0, y: 0 },
    data: { id: MANUAL_ID, type: 'manual', title: 'Manual Trigger' },
  }
}

const errors = (issues: ReturnType<typeof validateGraphStructure>) =>
  issues.filter((i) => i.severity === 'error')

describe('validateGraphStructure', () => {
  const graph: DraftGraph = { nodes: [manualNode(), appBlockNode()], edges: [] }

  it('refuses a NEWLY authored app-block node the org has not installed', () => {
    const blocking = errors(
      validateGraphStructure(graph, { lookup: coreOnly, newNodeIds: new Set([BLOCK_ID]) })
    )

    expect(blocking).toHaveLength(1)
    expect(blocking[0]?.message).toContain('Unknown node type')
  })

  it('accepts the same node once the lookup resolves it', () => {
    // The whole point of B2: this write used to be impossible, and the error
    // said the type did not exist when it plainly did.
    expect(
      errors(validateGraphStructure(graph, { lookup: withApp, newNodeIds: new Set([BLOCK_ID]) }))
    ).toEqual([])
  })

  it('never blocks a PRE-EXISTING app-block node either way', () => {
    // Not in `newNodeIds`: an orphan from an uninstalled app must not make the
    // whole workflow uneditable (the #1649 shape).
    expect(errors(validateGraphStructure(graph, { lookup: coreOnly }))).toEqual([])
    expect(errors(validateGraphStructure(graph, { lookup: withApp }))).toEqual([])
  })
})

describe('validateGraphStructure — the S2 op asymmetry', () => {
  const fabricated = (): DraftGraph => ({
    nodes: [manualNode(), appBlockNode({ operation: 'teleport' })],
    edges: [],
  })

  it('BLOCKS a newly authored node whose operation the block does not offer', () => {
    // Same class of defect as a fabricated `{{Node.field}}` ref: nothing
    // downstream contradicts it, so the author believes the write worked.
    const blocking = errors(
      validateGraphStructure(fabricated(), { lookup: withApp, newNodeIds: new Set([BLOCK_ID]) })
    )

    expect(blocking).toHaveLength(1)
    expect(blocking[0]?.field).toBe('operation')
    expect(blocking[0]?.message).toContain('shipment.track')
  })

  it('never blocks the SAME defect on a pre-existing node', () => {
    // An app upgrade dropped the operation under a stored node. Blocking here
    // would make the whole workflow uneditable over one drifted node — the
    // #1649 shape. It is still reported (and still refuses `run_node`) through
    // the non-blocking tier-2 pass.
    expect(errors(validateGraphStructure(fabricated(), { lookup: withApp }))).toEqual([])
    expect(
      validateNodeConfigs(fabricated(), withApp).some(
        (i) => i.severity === 'error' && i.field === 'operation'
      )
    ).toBe(true)
  })

  it('does not promote the other tier-2 errors a validator reports', () => {
    // A missing WORKSPACE CONNECTION is a tier-2 `error` — it gates `run_node`
    // because the run is guaranteed to fail. It must NOT block the write:
    // adding a node before anyone has connected the app is legitimate
    // authoring, and refusing it would be unfixable from inside the editor.
    const unconnected: ManifestLookup = (type) =>
      getManifest(type) ??
      (type === APP_TYPE
        ? synthesizeAppBlockManifest(
            { ...installation, orgConnectionPresent: false } as CachedInstalledApp,
            { ...block, requiresConnection: true }
          )
        : undefined)
    const graph: DraftGraph = { nodes: [manualNode(), appBlockNode()], edges: [] }

    expect(
      errors(
        validateGraphStructure(graph, { lookup: unconnected, newNodeIds: new Set([BLOCK_ID]) })
      )
    ).toEqual([])
    expect(
      validateNodeConfigs(graph, unconnected).some(
        (i) => i.severity === 'error' && i.field === 'connectionId'
      )
    ).toBe(true)
  })

  it('promotes nothing for core types', () => {
    // No core manifest sets `blocksAuthoring`, so the newNodeIds arm must stay
    // exactly as strict as it was — type existence and authorability only.
    const graph: DraftGraph = { nodes: [manualNode()], edges: [] }

    expect(
      errors(validateGraphStructure(graph, { lookup: withApp, newNodeIds: new Set([MANUAL_ID]) }))
    ).toEqual([])
  })
})

describe('validateNodeConfigs', () => {
  it('says nothing about an app block the core registry cannot see', () => {
    // `if (!manifest) continue` — zero config validation, ever. This is the
    // silence B2 replaces.
    const graph: DraftGraph = { nodes: [appBlockNode({ operation: 'teleport' })], edges: [] }

    expect(validateNodeConfigs(graph, coreOnly)).toEqual([])
  })

  it('runs the synthesized validator once the lookup resolves it', () => {
    const graph: DraftGraph = { nodes: [appBlockNode({ operation: 'teleport' })], edges: [] }
    const issues = validateNodeConfigs(graph, withApp)

    expect(issues.some((i) => i.severity === 'error' && i.field === 'operation')).toBe(true)
  })
})

describe('buildGraphSummary', () => {
  const graph: DraftGraph = { nodes: [manualNode(), appBlockNode()], edges: [] }

  it('lists an unresolvable app block as read-only', () => {
    expect(buildGraphSummary(graph, coreOnly).readOnlyNodes).toEqual(['FedEx'])
  })

  it('stops listing it once the org has the app installed', () => {
    // The §8 outcome: an installed app's block is authorable, so it is no
    // longer announced as read-only on every single read.
    expect(buildGraphSummary(graph, withApp).readOnlyNodes).toBeUndefined()
  })
})

describe('isInputNodePair', () => {
  it('refuses an app block as an input node, by declaration rather than by absence', () => {
    // Before B2 this held because the app block had NO manifest. Now it holds
    // because the manifest says `category: INTEGRATION` and
    // `acceptsInputNodes: false` — which is what must keep holding.
    const target = manualNode()

    expect(isInputNodePair(appBlockNode(), target, coreOnly)).toBe(false)
    expect(isInputNodePair(appBlockNode(), target, withApp)).toBe(false)
    // The manifest states it outright, so the guard no longer rests on silence.
    expect(withApp(APP_TYPE)?.connection.acceptsInputNodes).toBe(false)
  })

  it('still accepts the real input pair it exists for', () => {
    const form: GraphNode = {
      id: FORM_ID,
      type: 'standard',
      position: { x: 0, y: 0 },
      data: { id: FORM_ID, type: 'form-input', title: 'Order number' },
    }

    expect(isInputNodePair(form, manualNode(), withApp)).toBe(true)
  })
})

describe('resolveConnectionSpec', () => {
  it('connects an app block on the default source handle', () => {
    // App blocks declare no branches, so this is unchanged — but it is now
    // unchanged because the manifest says so, not because it was missing.
    const nodes = [appBlockNode()]

    expect(resolveConnectionSpec(nodes, { after: 'FedEx' }, withApp)._unsafeUnwrap()).toEqual({
      sourceNodeId: BLOCK_ID,
      sourceHandle: 'source',
    })
  })

  it('rejects a branch on a node that has none', () => {
    const result = resolveConnectionSpec(
      [appBlockNode()],
      { after: 'FedEx', branch: 'fail' },
      withApp
    )

    expect(result.isErr()).toBe(true)
  })
})
