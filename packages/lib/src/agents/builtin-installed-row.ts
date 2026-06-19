// packages/lib/src/agents/builtin-installed-row.ts

import { z } from 'zod'
import type { AgentToolDefinition } from '../ai/agent-framework/types'
import {
  createActorCapabilities,
  createEntityCapabilities,
  createKbCapabilities,
  createKbReadCapabilities,
  createKnowledgeCapabilities,
  createMailCapabilities,
  createTaskCapabilities,
  type GetToolDeps,
  type PageCapability,
} from '../ai/kopilot/capabilities'
import type { CachedAgentTool, CachedInstalledApp } from '../cache/org-cache-keys'
import { BUILTIN_APP, BUILTIN_TOOLSETS } from './builtin-app'
import { toolCategory } from './tool-visibility'

/**
 * Stub `getDeps` for catalog enumeration. Tool factories capture `getDeps` in
 * a closure for `execute`-time use only — constructing the tool definition
 * (name, description, toolsetSlug) never invokes the factory.
 */
const catalogGetDeps: GetToolDeps = () => {
  throw new Error('builtin-installed-row: getDeps is for metadata enumeration only')
}

function collectNativeCapabilities(): PageCapability[] {
  return [
    createMailCapabilities(catalogGetDeps),
    createEntityCapabilities(catalogGetDeps),
    createKnowledgeCapabilities(catalogGetDeps),
    createActorCapabilities(catalogGetDeps),
    createTaskCapabilities(catalogGetDeps),
    createKbCapabilities(catalogGetDeps),
    createKbReadCapabilities(catalogGetDeps),
  ]
}

const BUILTIN_TOOLSET_ICON_BY_SLUG = new Map<string, string | null>(
  BUILTIN_TOOLSETS.map((ts) => [ts.slug, ts.iconKey])
)

function lookupIconForSlug(slug: string): string {
  return BUILTIN_TOOLSET_ICON_BY_SLUG.get(slug) ?? BUILTIN_APP.avatarUrl
}

/**
 * Serialize a native tool's Zod `outputSchema` to JSON Schema for the cache
 * projection — the same `z.toJSONSchema` emission the SDK publish path uses
 * for app catalogs (`zod-to-provider-tool-schema.ts`), minus the `auxxRef`
 * mining only app schemas need. `{}` ⇒ no declared schema (the eval editor
 * renders a free-form mock).
 */
function serializeOutputSchema(schema: z.ZodType | undefined): Record<string, unknown> {
  if (!schema) return {}
  try {
    const raw = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>
    delete raw.$schema
    delete raw.id
    return raw
  } catch {
    return {}
  }
}

function buildBuiltinAgentTools(): CachedAgentTool[] {
  const out: CachedAgentTool[] = []
  for (const cap of collectNativeCapabilities()) {
    for (const tool of cap.tools as AgentToolDefinition[]) {
      if (!tool.toolsetSlug) continue
      out.push({
        id: tool.name,
        name: tool.displayName,
        description: tool.description,
        inputsJsonSchema: tool.parameters ?? {},
        outputsJsonSchema: serializeOutputSchema(tool.outputSchema),
        exampleOutput: tool.exampleOutput,
        requiresConnection: false,
        timeoutMs: 30_000,
        streaming: false,
        refs: [],
        agentName: tool.name,
        agentDescription: tool.description,
        toolsetSlug: tool.toolsetSlug,
        idempotent: tool.idempotent ?? false,
        category: toolCategory(tool),
        // Built-in tools register under their bare snake_case name (no
        // `<slug>_` prefix that third-party tools get from
        // `getRegisteredToolName`). The kopilot `useToolAppResolver` keys off
        // `registeredName` directly, so feeding it the bare name matches what
        // the LLM actually invokes.
        registeredName: tool.name,
        iconId: lookupIconForSlug(tool.toolsetSlug),
        surfaces: tool.surfaces,
        externalSafe: tool.externalSafe,
        // Per-input author-default bindings (plans/chat/v8 phase-3).
        inputBindings: tool.inputBindings,
      })
    }
  }
  return out
}

let memo: CachedInstalledApp | null = null

/**
 * Memoized synthetic `CachedInstalledApp` for the built-in Auxx.ai app.
 * Prepended to the third-party installations list by `installedAppsProvider`
 * so every catalog consumer (Tools tab, pickers, kopilot pill resolver)
 * sees the built-in app via the same shape as third-party apps. The memo
 * is safe because `BUILTIN_TOOLSETS` is static and
 * `collectNativeCapabilities()` only reads factory metadata — no runtime
 * side effects.
 */
export function getBuiltinAuxxInstalledRow(): CachedInstalledApp {
  if (memo) return memo
  memo = {
    installationId: 'builtin:auxx',
    installationType: 'production',
    installedAt: '1970-01-01T00:00:00.000Z',
    app: BUILTIN_APP,
    currentDeployment: null,
    methods: [],
    connectionDefinitions: {},
    agentToolsets: [...BUILTIN_TOOLSETS],
    agentTools: buildBuiltinAgentTools(),
    orgConnectionPresent: false,
    orgConnectionExpiresAt: null,
  }
  return memo
}
