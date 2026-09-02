// packages/lib/src/ai/kopilot/capabilities/purchasing-intake/__tests__/purchasing-intake.test.ts
//
// What this proves, in the order the brief cares about
// (plans/money/tasks/38-purchase-order-from-a-document.md §4):
//
//  1. `purchasing.intake` is a REGISTERED page, not an invented string.
//     `registry.ts` warns that an unregistered name "resolves to the same set by
//     accident and reads like scoping while doing nothing", so the wiring is
//     exercised through a real `createCapabilityRegistry`, never asserted from
//     the capability object alone.
//  2. The page cannot write records outside the draft. This is the one property
//     the whole capability rests on: every global write tool in the native pool
//     is gone, and so is a synthetic app-backed tool — because app and MCP tools
//     register under `__global__` too and no hand-written deny-list can name
//     them (they are built at runtime from whatever the org installed).
//  3. The five reads §4.2 keeps are still there — that keep list is why the page
//     has two tools of its own and not six.
//  4. Both tools fail CLOSED when `ToolDeps.capabilities` is `undefined`, and
//     when no `intakeDraft` ref is in session context. Neither reaches a DB.
//  5. Neither tool takes a draft id, and `propose_draft` takes no transcription.
//
// Nothing here touches a database: the two negative-path cases short-circuit in
// `resolveIntakeSession` before `getIntakeDraft` is reached.

import { describe, expect, it } from 'vitest'
import type { AgentDeps, AgentToolDefinition } from '../../../../agent-framework/types'
import { createActorCapabilities } from '../../actors'
import { createEntityCapabilities } from '../../entities'
import { createKbReadCapabilities } from '../../kb'
import { createKnowledgeCapabilities } from '../../knowledge'
import { createKopilotCapabilities } from '../../kopilot'
import { createLearnedKbCapabilities } from '../../learned'
import { createMailCapabilities } from '../../mail'
import { createCapabilityRegistry } from '../../registry'
import { createTaskCapabilities } from '../../tasks'
import type { GetToolDeps, PageCapability } from '../../types'
import {
  createPurchasingIntakeCapabilities,
  PURCHASING_INTAKE_KEPT_GLOBAL_TOOLS,
  PURCHASING_INTAKE_PAGE,
} from '../index'

const ORG = 'org-1'

const AGENT_DEPS: AgentDeps = {
  organizationId: ORG,
  userId: 'member-1',
  sessionId: 's-1',
}

/** Deps with NO capability view — the shape every fail-closed case asserts on. */
const unrestrictedDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: { page: PURCHASING_INTAKE_PAGE, references: [] },
    organizationId: ORG,
    userId: 'member-1',
    sessionId: 's-1',
    capabilities: undefined,
  }) as never

/** Deps with a capability view but no draft in session context. */
const noDraftDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: { page: PURCHASING_INTAKE_PAGE, references: [] },
    organizationId: ORG,
    userId: 'member-1',
    sessionId: 's-1',
    capabilities: { canViewEntity: () => true },
  }) as never

/**
 * A stand-in for the app / MCP bridges, which register their runtime-built tools
 * under `__global__`. Named so a failure reads as what it is.
 */
const APP_BACKED_GLOBAL: PageCapability = {
  page: '__global__',
  tools: [
    {
      name: 'app_shopify_create_order',
      displayName: 'Create order',
      description: 'A third-party write tool the platform cannot name in advance.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      permission: { target: 'bridge', governedBy: 'app', note: 'test fixture' },
      execute: async () => ({ success: true, output: null }),
    },
  ],
}

function buildRegistry(getDeps: GetToolDeps) {
  const registry = createCapabilityRegistry()
  registry.register(createEntityCapabilities(getDeps))
  registry.register(createMailCapabilities(getDeps))
  registry.register(createTaskCapabilities(getDeps))
  registry.register(createActorCapabilities(getDeps))
  registry.register(createKopilotCapabilities(getDeps))
  registry.register(createKnowledgeCapabilities(getDeps))
  registry.register(createKbReadCapabilities(getDeps))
  registry.register(createLearnedKbCapabilities(getDeps))
  registry.register(APP_BACKED_GLOBAL)
  registry.register(createPurchasingIntakeCapabilities(getDeps))
  return registry
}

function toolNamed(name: string): AgentToolDefinition {
  const tool = createPurchasingIntakeCapabilities(unrestrictedDeps).tools.find(
    (t) => t.name === name
  )
  if (!tool) throw new Error(`no such tool: ${name}`)
  return tool
}

/** Every property name a JSON-Schema tree declares, at any depth. */
function propertyNames(schema: unknown, into = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== 'object') return into
  const node = schema as Record<string, unknown>
  const properties = node.properties
  if (properties && typeof properties === 'object') {
    for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
      into.add(key)
      propertyNames(child, into)
    }
  }
  propertyNames(node.items, into)
  return into
}

async function run(tool: AgentToolDefinition, args: Record<string, unknown>) {
  const result = await tool.execute(args, AGENT_DEPS as never)
  if (Symbol.asyncIterator in Object(result)) throw new Error('unexpected streaming tool')
  return result as Awaited<ReturnType<AgentToolDefinition['execute']>> & {
    success: boolean
    error?: string
  }
}

describe('purchasing.intake — registration and tool scope', () => {
  it('registers under a real page key', () => {
    expect(PURCHASING_INTAKE_PAGE).toBe('purchasing.intake')
    const registry = buildRegistry(unrestrictedDeps)
    expect(registry.getPages()).toContain(PURCHASING_INTAKE_PAGE)
  })

  it('resolves EXACTLY the two page tools plus the five kept global reads', () => {
    const names = buildRegistry(unrestrictedDeps)
      .getTools(PURCHASING_INTAKE_PAGE)
      .map((t) => t.name)
      .sort()
    expect(names).toEqual(
      [...PURCHASING_INTAKE_KEPT_GLOBAL_TOOLS, 'resolve_lines', 'propose_draft'].sort()
    )
  })

  it('strips every global write tool, including one it could not have named', () => {
    const excluded = new Set(
      buildRegistry(unrestrictedDeps).getExcludedGlobalToolNames(PURCHASING_INTAKE_PAGE)
    )
    for (const name of [
      // Entity writes — the reason this line exists at all (§4.1).
      'create_entity',
      'update_entity',
      'bulk_update_entity',
      'create_note',
      // Tasks
      'create_task',
      'list_tasks',
      // Mail. NOTE: these are NOT `mail_*` prefixed in this repo, which is why
      // the exclusion is an allow-list predicate rather than a name pattern.
      'find_threads',
      'get_thread_detail',
      'list_drafts',
      'list_tags',
      'reply_to_thread',
      'start_new_conversation',
      'update_thread',
      // AI-memory write
      'upsert_learned_article',
      // Noise the intake run has no use for
      'list_notes',
      'list_field_changes',
      'get_entity_history',
      'list_transcripts_for_entity',
      'get_transcript',
      'list_members',
      'list_groups',
      'search_docs',
      'search_knowledge',
      'get_article',
      'list_articles',
      'plan_create',
      'plan_update_step',
      // App- and MCP-backed tools register under `__global__` too.
      'app_shopify_create_order',
    ]) {
      expect(excluded.has(name), `${name} must be excluded on the intake page`).toBe(true)
    }
  })

  it('keeps the reads §4.2 deliberately did not replace with bespoke tools', () => {
    const names = new Set(
      buildRegistry(unrestrictedDeps)
        .getTools(PURCHASING_INTAKE_PAGE)
        .map((t) => t.name)
    )
    for (const kept of [
      'search_entities',
      'query_records',
      'get_entity',
      'list_entities',
      'list_entity_fields',
    ]) {
      expect(names.has(kept), `${kept} must survive on the intake page`).toBe(true)
    }
  })

  it('declares exactly two tools of its own', () => {
    const tools = createPurchasingIntakeCapabilities(unrestrictedDeps).tools.map((t) => t.name)
    expect(tools.sort()).toEqual(['propose_draft', 'resolve_lines'])
  })
})

describe('purchasing.intake — permission declarations', () => {
  it('both tools declare an enforced, non-plumbing permission', () => {
    for (const tool of createPurchasingIntakeCapabilities(unrestrictedDeps).tools) {
      const permission = tool.permission
      expect(permission, tool.name).toBeDefined()
      if (!permission) continue
      expect(permission.target, tool.name).toBe('definition')
      expect('enforcement' in permission && permission.enforcement, tool.name).toBe('enforced')
    }
  })

  it('propose_draft is VIEW on purchase_order, not create — a draft is not a purchase order', () => {
    const permission = toolNamed('propose_draft').permission
    expect(permission).toMatchObject({ target: 'definition', level: 'view' })
    expect(JSON.stringify(permission)).toContain('purchase_order')
  })

  it('propose_draft ends the turn, so its arguments ARE the structured output', () => {
    expect(toolNamed('propose_draft').endsTurn).toBe(true)
    expect(toolNamed('resolve_lines').endsTurn).toBeFalsy()
  })

  it('neither tool claims idempotence — both write the draft row', () => {
    for (const tool of createPurchasingIntakeCapabilities(unrestrictedDeps).tools) {
      expect(tool.idempotent, tool.name).toBeUndefined()
    }
  })
})

describe('purchasing.intake — the draft is a session ref, never an argument', () => {
  it('no tool accepts a draft id', () => {
    for (const tool of createPurchasingIntakeCapabilities(unrestrictedDeps).tools) {
      expect(JSON.stringify(tool.parameters).toLowerCase(), tool.name).not.toContain('draftid')
    }
  })

  it('propose_draft takes decisions only — no transcribed money crosses it', () => {
    // 🛑 Property NAMES, not the serialized blob: the prose legitimately says
    // "header total" while the schema must carry no total to re-type.
    const names = propertyNames(toolNamed('propose_draft').parameters)
    expect(names).toEqual(
      new Set([
        'header',
        'vendorRecordId',
        'currency',
        'quoteNumber',
        'quoteDate',
        'expectedDeliveryDate',
        'lines',
        'lineId',
        'partRecordId',
        'foldedInto',
        'chosenBreakIndex',
      ])
    )
  })

  it('resolve_lines takes no money either — overrides are matching inputs only', () => {
    const names = propertyNames(toolNamed('resolve_lines').parameters)
    expect(names).toEqual(
      new Set([
        'vendorRecordId',
        'currency',
        'lines',
        'lineNumber',
        'vendorCode',
        'description',
        'quantity',
        'unit',
      ])
    )
  })
})

describe('purchasing.intake — fail-closed', () => {
  it.each([
    'resolve_lines',
    'propose_draft',
  ])('%s refuses when the run has no capability view', async (name) => {
    const tool = createPurchasingIntakeCapabilities(unrestrictedDeps).tools.find(
      (t) => t.name === name
    )
    const result = await run(tool as AgentToolDefinition, {
      vendorRecordId: null,
      header: { vendorRecordId: null },
      lines: [],
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('capability view')
  })

  it.each([
    'resolve_lines',
    'propose_draft',
  ])('%s refuses when no intakeDraft ref is in session context', async (name) => {
    const tool = createPurchasingIntakeCapabilities(noDraftDeps).tools.find((t) => t.name === name)
    const result = await run(tool as AgentToolDefinition, {
      vendorRecordId: null,
      header: { vendorRecordId: null },
      lines: [],
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('intakeDraft')
  })
})
