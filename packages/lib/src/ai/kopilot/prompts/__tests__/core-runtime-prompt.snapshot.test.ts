// packages/lib/src/ai/kopilot/prompts/__tests__/core-runtime-prompt.snapshot.test.ts

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  fixtureCurrentUser,
  fixtureDomainState,
  fixtureEntityCatalog,
  fixtureIntegrations,
  fixtureTools,
  fixtureToolsetAdditions,
} from '../__test-fixtures'
import { buildCoreRuntimePrompt } from '../core-runtime-prompt'

/**
 * Byte-equality snapshot harness. The point of this test is to lock in the
 * exact rendered output BEFORE the section-registry refactor lands; phases B
 * and C must keep these snapshots green. Whitespace normalisation in phase D
 * is the one expected snapshot diff (single-blank-line separation everywhere).
 */

const baseArgs = {
  domainState: fixtureDomainState,
  entityCatalog: fixtureEntityCatalog,
  tools: fixtureTools,
  currentUser: fixtureCurrentUser,
  integrations: fixtureIntegrations,
  toolsetPromptAdditions: fixtureToolsetAdditions,
}

describe('buildCoreRuntimePrompt snapshot', () => {
  // The `now` section reads the wall clock, so the snapshot is only stable
  // against a frozen one. UTC is the rendered zone either way (no caller zone
  // is threaded), so the host machine's zone doesn't leak in.
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T09:07:00.000Z'))
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  it('renders identical interactive prompt', () => {
    const out = buildCoreRuntimePrompt({ ...baseArgs, runMode: 'interactive' })
    expect(out).toMatchSnapshot()
  })

  it('renders identical autonomous prompt', () => {
    const out = buildCoreRuntimePrompt({ ...baseArgs, runMode: 'autonomous' })
    expect(out).toMatchSnapshot()
  })
})
