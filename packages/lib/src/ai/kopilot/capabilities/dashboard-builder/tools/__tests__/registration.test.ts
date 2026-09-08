// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/__tests__/registration.test.ts
//
// The capability is REACHABLE through the registry under its own page key.
//
// Every other suite here proves the tools behave. None of them proves the
// tools are wired, and that is a distinct and very quiet failure: a capability
// can be fully built, fully tested, exported from two barrels, and still
// resolve to nothing at runtime. It has happened in this codebase before, for
// a reason no test would have caught: the workflow-builder tools carried a
// `toolsetSlug`, master Kopilot's `kopilot.toolsets` default is the glob
// `auxx:*` which cannot match a slug outside that namespace, and
// `filterToolsByToolsets` therefore stripped all 15 after registration. The
// prompt section still rendered. The capability advertised itself and had no
// tools.
//
// So this pins the registry contract itself: the page resolves to a non-empty
// tool set, every tool is builder-surfaced and permission-declared, the summary
// bullet claims editing only while a write tool survives, and an unregistered
// page gets nothing rather than another page's tools.

import { describe, expect, it } from 'vitest'
import type { AgentToolDefinition } from '../../../../../agent-framework/types'
import { createCapabilityRegistry } from '../../../registry'
import type { GetToolDeps } from '../../../types'
import { createDashboardBuilderCapabilities, DASHBOARD_BUILDER_PAGE } from '../../index'

/**
 * Tool FACTORIES must not touch deps at construction time (they close over
 * `getDeps` and call it inside `execute`), so a throwing stub is the strongest
 * available assertion that nothing is resolved eagerly.
 */
const getDeps = (() => {
  throw new Error('deps must not be resolved at capability construction time')
}) as unknown as GetToolDeps

function resolveTools(): AgentToolDefinition[] {
  const registry = createCapabilityRegistry()
  registry.register(createDashboardBuilderCapabilities(getDeps))
  return registry.getTools(DASHBOARD_BUILDER_PAGE)
}

describe('dashboard-builder registration', () => {
  it('resolves a non-empty tool set under `dashboard.builder`', () => {
    const names = resolveTools().map((t) => t.name)
    // Not an exact-count assertion: adding a tool should not fail this file.
    // The contract is that the page resolves, and that the four tools the
    // capability is FOR are among what it resolves to.
    expect(names.length).toBeGreaterThan(0)
    expect(names).toEqual(expect.arrayContaining(['get_dashboard', 'add_widget']))
    expect(names).toEqual(expect.arrayContaining(['preview_widget', 'validate_dashboard']))
    expect(new Set(names).size).toBe(names.length)
  })

  it('declares every tool as builder-surfaced and enforced', () => {
    for (const tool of resolveTools()) {
      // Builder-only: graph/layout editing has no meaning on chat or email, and
      // a runtime AI node must never inherit these.
      expect(tool.surfaces, tool.name).toEqual(['builder'])
      const permission = tool.permission as
        | { target?: string; level?: string; enforcement?: string }
        | undefined
      expect(permission?.target, tool.name).toBe('instance')
      expect(permission?.enforcement, tool.name).toBe('enforced')
      expect(['view', 'edit', 'admin']).toContain(permission?.level)
    }
  })

  it('carries no toolsetSlug: these mount by PAGE, never by an org grant', () => {
    // The exact regression described in this file's header. A slug here is not
    // a stricter gate, it is an off switch.
    for (const tool of resolveTools()) {
      expect(tool.toolsetSlug, tool.name).toBeUndefined()
    }
  })

  it('claims editing only while a write tool survives runtime filtering', () => {
    const registry = createCapabilityRegistry()
    registry.register(createDashboardBuilderCapabilities(getDeps))

    const withWrites = registry.getCapabilitiesSummary(DASHBOARD_BUILDER_PAGE, {
      toolNames: new Set(resolveTools().map((t) => t.name)),
    })
    expect(withWrites.join(' ')).toMatch(/build, and edit/)

    // Same capability, every write tool filtered out: the bullet must retreat
    // to a read-only claim rather than advertise an ability that is now absent.
    const readsOnly = registry.getCapabilitiesSummary(DASHBOARD_BUILDER_PAGE, {
      toolNames: new Set(['get_dashboard', 'get_widget']),
    })
    expect(readsOnly.join(' ')).not.toMatch(/build, and edit/)
  })

  it('renders a prompt section for the page', () => {
    const registry = createCapabilityRegistry()
    registry.register(createDashboardBuilderCapabilities(getDeps))
    const addition = registry.getSystemPromptAddition(DASHBOARD_BUILDER_PAGE, {
      toolNames: new Set(resolveTools().map((t) => t.name)),
    })
    expect(addition).toBeTruthy()
    // The one thing the model must not get wrong about this surface: edits go
    // to the draft, and only the USER publishes.
    expect(addition?.toLowerCase()).toContain('draft')
  })

  it('leaks nothing to an unregistered page', () => {
    const registry = createCapabilityRegistry()
    registry.register(createDashboardBuilderCapabilities(getDeps))
    expect(registry.getTools('some.other.page')).toHaveLength(0)
  })
})
