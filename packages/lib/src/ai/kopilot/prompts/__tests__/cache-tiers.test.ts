// packages/lib/src/ai/kopilot/prompts/__tests__/cache-tiers.test.ts

import { describe, expect, it } from 'vitest'
import {
  fixtureCapabilities,
  fixtureCurrentUser,
  fixtureDomainState,
  fixtureEntityCatalog,
  fixtureIntegrations,
  fixtureTools,
  fixtureToolsetAdditions,
} from '../__test-fixtures'
import {
  buildKopilotPrompt,
  buildKopilotPromptBlocks,
  buildKopilotPromptSerialized,
  CACHE_BREAK_SENTINEL,
  stripCacheBreakSentinels,
} from '../build-kopilot-prompt'

const baseArgs = {
  domainState: fixtureDomainState,
  entityCatalog: fixtureEntityCatalog,
  capabilities: fixtureCapabilities,
  tools: fixtureTools,
  currentUser: fixtureCurrentUser,
  integrations: fixtureIntegrations,
  toolsetPromptAdditions: fixtureToolsetAdditions,
}

describe('buildKopilotPromptBlocks', () => {
  it('groups consecutive same-tier sections into one block', () => {
    const blocks = buildKopilotPromptBlocks(baseArgs)
    const tiers = blocks.map((b) => b.stability)
    // Tier ordering invariant: each tier appears contiguously, in static→org→turn order
    const firstOrg = tiers.indexOf('org')
    const firstTurn = tiers.indexOf('turn')
    if (firstOrg >= 0) expect(tiers.indexOf('static')).toBeLessThan(firstOrg)
    if (firstTurn >= 0 && firstOrg >= 0) expect(firstOrg).toBeLessThan(firstTurn)
    // Same tier never repeats after another tier
    const collapsed = tiers.filter((t, i) => t !== tiers[i - 1])
    expect(collapsed).toEqual(Array.from(new Set(tiers)))
  })

  it('marks the last static and last org blocks with ephemeral cache', () => {
    const blocks = buildKopilotPromptBlocks(baseArgs)
    const lastStatic = blocks.map((b) => b.stability).lastIndexOf('static')
    const lastOrg = blocks.map((b) => b.stability).lastIndexOf('org')
    if (lastStatic >= 0) expect(blocks[lastStatic].cache).toEqual({ type: 'ephemeral' })
    if (lastOrg >= 0) expect(blocks[lastOrg].cache).toEqual({ type: 'ephemeral' })
    // Turn-tier blocks never cached
    for (const b of blocks) {
      if (b.stability === 'turn') expect(b.cache).toBeUndefined()
    }
  })
})

describe('serializePromptBlocks (via buildKopilotPromptSerialized)', () => {
  it('embeds a sentinel after each cached block', () => {
    const serialized = buildKopilotPromptSerialized(baseArgs)
    const blocks = buildKopilotPromptBlocks(baseArgs)
    const cacheCount = blocks.filter((b) => b.cache).length
    const matches = serialized.match(new RegExp(CACHE_BREAK_SENTINEL, 'g')) ?? []
    expect(matches.length).toBe(cacheCount)
  })

  it('stripping sentinels yields the plain buildKopilotPrompt output', () => {
    const stripped = stripCacheBreakSentinels(buildKopilotPromptSerialized(baseArgs))
    expect(stripped).toBe(buildKopilotPrompt(baseArgs))
  })
})
