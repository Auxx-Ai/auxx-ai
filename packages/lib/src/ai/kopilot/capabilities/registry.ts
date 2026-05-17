// packages/lib/src/ai/kopilot/capabilities/registry.ts

import type { AgentToolDefinition } from '../../agent-framework/types'
import type { CapabilityRegistry, PageCapability, SystemPromptAdditionContext } from './types'

/** Registration key meaning "applies to every page". */
const GLOBAL_PAGE = '__global__'

type AdditionFragment = NonNullable<PageCapability['systemPromptAddition']>
type CapabilitiesFragment = NonNullable<PageCapability['capabilities']>

interface StoredPage {
  page: string
  tools: AgentToolDefinition[]
  /**
   * Fragments are stored in registration order and resolved lazily at read
   * time. A functional fragment can return different prose depending on
   * which tools survived runtime filtering, so it can't be pre-concatenated
   * with neighbouring fragments at register time.
   */
  additions: AdditionFragment[]
  /**
   * Capability bullets are stored per-registration so a functional form can
   * be re-evaluated against the live tool set when summary is read.
   */
  capabilities: CapabilitiesFragment[]
  excludes: ((toolName: string) => boolean)[]
}

function resolveAddition(fragment: AdditionFragment, ctx: SystemPromptAdditionContext): string {
  return typeof fragment === 'function' ? fragment(ctx) : fragment
}

function resolveCapabilities(
  fragment: CapabilitiesFragment,
  ctx: SystemPromptAdditionContext
): string[] {
  return typeof fragment === 'function' ? fragment(ctx) : fragment
}

/**
 * Compile a capability's `excludeGlobalTools` declaration into a predicate.
 * Strings ending in `*` are treated as prefix patterns; all other strings
 * are exact-match. A function is used verbatim.
 */
function compileExcludePredicate(
  spec: PageCapability['excludeGlobalTools']
): ((toolName: string) => boolean) | undefined {
  if (!spec) return undefined
  if (typeof spec === 'function') return spec
  if (spec.length === 0) return undefined
  const exact = new Set<string>()
  const prefixes: string[] = []
  for (const entry of spec) {
    if (entry.endsWith('*')) prefixes.push(entry.slice(0, -1))
    else exact.add(entry)
  }
  return (name: string) => {
    if (exact.has(name)) return true
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) return true
    }
    return false
  }
}

/**
 * Create a capability registry that maps pages to their tool sets.
 *
 * Tool resolution is page-scoped:
 *   getTools(page) → tools from the capability registered under that page key
 *                    + tools from the `__global__` capability (if any).
 *
 * An unknown page falls back to global tools only — we do NOT return every
 * capability's tools, because that would leak mail tools onto a contacts page,
 * spend context on irrelevant tool descriptions, and violate F20.
 */
export function createCapabilityRegistry(): CapabilityRegistry {
  const pages = new Map<string, StoredPage>()

  return {
    getTools(page: string): AgentToolDefinition[] {
      const collected: AgentToolDefinition[] = []
      const global = pages.get(GLOBAL_PAGE)
      const scoped = pages.get(page)
      const excluded = scoped?.excludes.length
        ? (name: string) => scoped.excludes.some((fn) => fn(name))
        : undefined
      if (global) {
        for (const tool of global.tools) {
          if (excluded?.(tool.name)) continue
          collected.push(tool)
        }
      }
      if (scoped) collected.push(...scoped.tools)
      // Dedupe by name — page-scoped wins when a name clashes with a global one
      const byName = new Map<string, AgentToolDefinition>()
      for (const tool of collected) byName.set(tool.name, tool)
      return [...byName.values()]
    },

    getExcludedGlobalToolNames(page: string): string[] {
      const global = pages.get(GLOBAL_PAGE)
      const scoped = pages.get(page)
      if (!global || !scoped?.excludes.length) return []
      const out: string[] = []
      for (const tool of global.tools) {
        if (scoped.excludes.some((fn) => fn(tool.name))) out.push(tool.name)
      }
      return out
    },

    getPages(): string[] {
      return [...pages.keys()]
    },

    getSystemPromptAddition(page: string, ctx: SystemPromptAdditionContext): string | undefined {
      const rendered: string[] = []
      const global = pages.get(GLOBAL_PAGE)
      if (global) {
        for (const fragment of global.additions) {
          const text = resolveAddition(fragment, ctx).trim()
          if (text) rendered.push(text)
        }
      }
      const scoped = pages.get(page)
      if (scoped) {
        for (const fragment of scoped.additions) {
          const text = resolveAddition(fragment, ctx).trim()
          if (text) rendered.push(text)
        }
      }
      return rendered.length > 0 ? rendered.join('\n\n') : undefined
    },

    getCapabilitiesSummary(ctx?: SystemPromptAdditionContext): string[] {
      const resolveCtx: SystemPromptAdditionContext = ctx ?? { toolNames: new Set() }
      const all: string[] = []
      for (const capability of pages.values()) {
        for (const fragment of capability.capabilities) {
          all.push(...resolveCapabilities(fragment, resolveCtx))
        }
      }
      return all
    },

    register(capability: PageCapability): void {
      const existing = pages.get(capability.page)
      const compiledExclude = compileExcludePredicate(capability.excludeGlobalTools)
      if (existing) {
        existing.tools.push(...capability.tools)
        if (capability.systemPromptAddition) {
          existing.additions.push(capability.systemPromptAddition)
        }
        if (capability.capabilities) {
          existing.capabilities.push(capability.capabilities)
        }
        if (compiledExclude) existing.excludes.push(compiledExclude)
      } else {
        pages.set(capability.page, {
          page: capability.page,
          tools: [...capability.tools],
          additions: capability.systemPromptAddition ? [capability.systemPromptAddition] : [],
          capabilities: capability.capabilities ? [capability.capabilities] : [],
          excludes: compiledExclude ? [compiledExclude] : [],
        })
      }
    },
  }
}
