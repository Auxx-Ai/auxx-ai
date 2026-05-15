// packages/sdk/src/build/server/zod-to-provider-tool-schema.ts

import { z } from 'zod/v4'

/**
 * Provider flavor for the emitted JSON Schema. Anthropic accepts draft 2020-12
 * with optional fields out of `required`. OpenAI strict mode requires every
 * field in `required` (optional fields become nullable). v1 emits the neutral
 * Anthropic shape — Wedge A targets Anthropic; OpenAI-strict rewriting lands
 * once the model-router needs it.
 */
export type Provider = 'anthropic' | 'openai'

export interface ResolvedRef {
  /** Path through the output schema (object keys; arrays push '[]'). */
  path: string[]
  /** Ref kind from `refs.entity(...)`. */
  kind: string
}

export interface ConvertedSchema {
  /** LLM-facing JSON Schema with auxx-only meta stripped. */
  jsonSchema: Record<string, unknown>
  /** Marker-bearing field locations, mined out of `.meta({ auxxRef })`. */
  refs: ResolvedRef[]
}

/**
 * Convert a zod schema to provider-flavored JSON Schema, mining `auxxRef`
 * markers into a sibling `refs` array. See plans/kopilot/apps/README.md §4.3.
 */
export function zodToProviderToolSchema(
  schema: z.ZodTypeAny,
  _provider: Provider = 'anthropic'
): ConvertedSchema {
  const raw = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>
  // Drop fields the LLM doesn't need / shouldn't see.
  delete raw.$schema
  delete raw.id

  const refs: ResolvedRef[] = []
  const cleaned = stripAuxxRefAndMineRefs(raw, [], refs)
  return { jsonSchema: cleaned as Record<string, unknown>, refs }
}

/**
 * Recursively walk a JSON Schema node. Wherever we encounter the `auxxRef`
 * marker (added by `refs.entity(...)`), we capture its path + kind and strip
 * the marker from the emitted schema. Other node kinds pass through.
 */
function stripAuxxRefAndMineRefs(node: unknown, path: string[], out: ResolvedRef[]): unknown {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    return node.map((entry, i) => stripAuxxRefAndMineRefs(entry, [...path, String(i)], out))
  }
  const obj = { ...(node as Record<string, unknown>) }

  // zod v4 lifts `.meta()` keys onto the emitted JSON Schema node directly.
  // The marker key is `auxxRef`.
  if (obj.auxxRef && typeof obj.auxxRef === 'object') {
    const kind = (obj.auxxRef as { kind?: string }).kind
    if (typeof kind === 'string') {
      out.push({ path: [...path], kind })
    }
    delete obj.auxxRef
  }

  if (obj.properties && typeof obj.properties === 'object') {
    const props = obj.properties as Record<string, unknown>
    const cleanedProps: Record<string, unknown> = {}
    for (const key of Object.keys(props)) {
      cleanedProps[key] = stripAuxxRefAndMineRefs(props[key], [...path, key], out)
    }
    obj.properties = cleanedProps
  }
  if (obj.items) {
    obj.items = stripAuxxRefAndMineRefs(obj.items, [...path, '[]'], out)
  }
  if (obj.anyOf) {
    obj.anyOf = (obj.anyOf as unknown[]).map((entry) => stripAuxxRefAndMineRefs(entry, path, out))
  }
  if (obj.oneOf) {
    obj.oneOf = (obj.oneOf as unknown[]).map((entry) => stripAuxxRefAndMineRefs(entry, path, out))
  }
  return obj
}
