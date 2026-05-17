// packages/lib/src/ai/kopilot/prompts/sections/render.ts

import type { PromptCtx, PromptSection, Stability } from './types'

/**
 * A coherent slice of the system prompt with optional cache-control metadata.
 * Tier-aware composer groups consecutive same-tier outputs into one block
 * and marks the last block of each cached tier with `cache: { type: 'ephemeral' }`.
 */
export interface PromptBlock {
  readonly text: string
  readonly stability: Stability
  readonly cache?: { type: 'ephemeral' }
}

/**
 * Filter `sections` by ctx.runMode, render each, drop empty results,
 * join with `\n\n`. In dev builds, asserts the whitespace contract on
 * each section's output: no leading or trailing whitespace.
 */
export function renderSections(sections: readonly PromptSection[], ctx: PromptCtx): string {
  const parts: string[] = []
  for (const section of sections) {
    if (!section.modes.has(ctx.runMode)) continue
    const out = section.render(ctx)
    if (!out) continue
    if (process.env.NODE_ENV !== 'production' && out !== out.trim()) {
      throw new Error(`prompt section "${section.id}" violated whitespace contract`)
    }
    parts.push(out)
  }
  return parts.join('\n\n')
}

/**
 * Tier-aware composer. Groups consecutive same-stability section outputs
 * into one `PromptBlock` and marks the last block of each cached tier
 * (`static`, `org`) with `cache: { type: 'ephemeral' }`.
 *
 * Anthropic allows up to 4 cache breakpoints; we use 2 (end of static
 * tier, end of org tier). The turn tier is never cached.
 *
 * Caller is responsible for serializing the blocks — see
 * `serializePromptBlocks` for the sentinel-based string encoding used by
 * `AnthropicLLMClient` to recover per-block cache boundaries.
 */
export function renderSectionsToBlocks(
  sections: readonly PromptSection[],
  ctx: PromptCtx
): PromptBlock[] {
  // Group section outputs by stability tier, preserving registry order.
  const groups: { stability: Stability; parts: string[] }[] = []
  for (const section of sections) {
    if (!section.modes.has(ctx.runMode)) continue
    const out = section.render(ctx)
    if (!out) continue
    if (process.env.NODE_ENV !== 'production' && out !== out.trim()) {
      throw new Error(`prompt section "${section.id}" violated whitespace contract`)
    }
    const tail = groups[groups.length - 1]
    if (tail && tail.stability === section.stability) {
      tail.parts.push(out)
    } else {
      groups.push({ stability: section.stability, parts: [out] })
    }
  }

  const blocks: PromptBlock[] = groups.map((g) => ({
    stability: g.stability,
    text: g.parts.join('\n\n'),
  }))

  // Mark the last block of each cached tier with an ephemeral cache marker.
  for (const tier of ['static', 'org'] as const) {
    const lastIdx = lastIndexOf(blocks, (b) => b.stability === tier)
    if (lastIdx >= 0) {
      blocks[lastIdx] = { ...blocks[lastIdx], cache: { type: 'ephemeral' } }
    }
  }

  return blocks
}

function lastIndexOf<T>(arr: readonly T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i
  }
  return -1
}

/**
 * Sentinel inserted between tier blocks when serializing to a flat string.
 * `AnthropicLLMClient` recognises the marker and splits the system message
 * back into discrete `cache_control` blocks. Other providers should strip
 * the marker before sending to the model.
 *
 * The marker is intentionally HTML-comment-shaped so a stray copy in
 * non-Anthropic output is invisible if rendered as markdown.
 */
export const CACHE_BREAK_SENTINEL = '<!--auxx:cache-break-->'

/**
 * Flatten blocks into a single string with cache breakpoints encoded as
 * `CACHE_BREAK_SENTINEL` markers immediately before the next block. The
 * marker appears at the boundary of each cache breakpoint (one per
 * `block.cache`).
 */
export function serializePromptBlocks(blocks: readonly PromptBlock[]): string {
  const parts: string[] = []
  for (const b of blocks) {
    parts.push(b.text)
    // Emit a sentinel after every cached block; the receiver counts
    // sentinels and applies that many cache markers to the leading
    // segments. Trailing sentinels are tolerated when the per-turn tail
    // is empty.
    if (b.cache) parts.push(CACHE_BREAK_SENTINEL)
  }
  return parts.join('\n\n')
}

/** Remove all cache-break sentinels from a string. */
export function stripCacheBreakSentinels(text: string): string {
  if (!text.includes(CACHE_BREAK_SENTINEL)) return text
  return text.split(`\n\n${CACHE_BREAK_SENTINEL}\n\n`).join('\n\n')
}
