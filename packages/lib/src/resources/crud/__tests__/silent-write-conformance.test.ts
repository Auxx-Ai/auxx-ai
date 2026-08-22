// packages/lib/src/resources/crud/__tests__/silent-write-conformance.test.ts
//
// SILENT-WRITE CONFORMANCE (plan 04 Phase B).
//
// A write that shuts its doors must SAY WHY, in a form something can check.
// Before Phase B the reason lived in a comment beside a bare
// `publishEvents: false`, which is unenforceable — and B-16 is what that costs:
// `merge-service.ts` suppressed every door while claiming an aggregator that
// does not exist, and nothing caught it for as long as the claim was prose.
//
// So the declaration is a `WriteMode` on the session — `quiet(reason)` or
// `absorbed(by)` — and this file asserts the bare form has not come back.
//
// THE ALLOWLIST IS A LEDGER, NOT AN EXEMPTION. Every entry names the phase that
// closes it. An entry that stops deviating FAILS here, forcing its removal —
// the same discipline `door-conformance.test.ts` applies to `KNOWN_DEVIATIONS`.
// A new bare `publishEvents: false` anywhere in `packages/lib/src` also fails,
// which is the regression guard Phase A shipped the mechanism for but did not
// install.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  absorbedSession,
  isDeclaredSilent,
  quietSession,
  seedSession,
  sessionLane,
} from '../write-origin'

const LIB_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * Sites still passing a bare `publishEvents: false`, each with the plan phase
 * that migrates it. These are NOT exempt — they are scheduled.
 */
const PENDING_SILENT_WRITES: Record<string, { why: string; closedBy: string }> = {
  'resources/merge/merge-service.ts': {
    why: 'C3 with a missing aggregator — merge is silent end to end (B-16), so declaring `absorbed` here would be a lie until the aggregator exists',
    closedBy: 'plan 04 Phase C',
  },
  'recording/calendar/meeting-entity-service.ts': {
    why: 'C1, but the record is created outside the handler (B-20), so there is no create door to declare against yet',
    closedBy: 'plan 04 Phase D',
  },
  'recording/calendar/create-meeting-direct.ts': {
    why: 'C1, same handler bypass as meeting-entity-service (B-20)',
    closedBy: 'plan 04 Phase D',
  },
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

/**
 * Lines that PASS `publishEvents: false` as an argument, not lines that merely
 * mention it. Prose about the old mechanism is documentation, not a door.
 */
function bareSuppressionSites(): string[] {
  const hits: string[] = []
  for (const file of walk(LIB_SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!/publishEvents:\s*false/.test(line)) return
      const trimmed = line.trim()
      // Skip comment lines — `//`, and `*` / `/*` inside a JSDoc block.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      hits.push(`${relative(LIB_SRC, file).replace(/\\/g, '/')}:${i + 1}`)
    })
  }
  return hits.sort()
}

describe('silent-write conformance — every shut door names its reason', () => {
  it('no bare `publishEvents: false` outside the scheduled ledger', () => {
    const found = bareSuppressionSites()
    const unexpected = found.filter((site) => !(site.split(':')[0]! in PENDING_SILENT_WRITES))

    // A new one here means somebody suppressed a door without saying why.
    // Declare it instead: `quietSession(reason)` for C4/C5, or
    // `absorbedSession(by)` for C3 — and `by` must name a real aggregator.
    expect(unexpected).toEqual([])
  })

  it('every ledger entry is still deviating — a closed one must be removed', () => {
    const files = new Set(bareSuppressionSites().map((site) => site.split(':')[0]!))
    for (const [file, entry] of Object.entries(PENDING_SILENT_WRITES)) {
      expect(
        files.has(file),
        `${file} no longer passes a bare publishEvents: false — ${entry.closedBy} appears done, so drop its PENDING_SILENT_WRITES entry`
      ).toBe(true)
    }
  })

  it('the ledger states, per entry, why it cannot be declared yet and what closes it', () => {
    for (const [file, entry] of Object.entries(PENDING_SILENT_WRITES)) {
      expect(entry.why.length, `${file} needs a reason`).toBeGreaterThan(20)
      expect(entry.closedBy, `${file} needs a closing phase`).toMatch(/plan \d+ Phase [A-E]/)
    }
  })
})

describe('the declarations themselves', () => {
  it('a quiet session is silent, and carries its reason', () => {
    const session = quietSession('because the derivation is not a user edit')
    expect(sessionLane(session)).toBe('silent')
    expect(isDeclaredSilent(session)).toBe(true)
    expect(session.mode).toEqual({
      kind: 'quiet',
      reason: 'because the derivation is not a user edit',
    })
  })

  it('an absorbed session is silent, and names its aggregator', () => {
    const session = absorbedSession('setBulkValues')
    expect(sessionLane(session)).toBe('silent')
    expect(isDeclaredSilent(session)).toBe(true)
    expect(session.mode).toEqual({ kind: 'absorbed', by: 'setBulkValues' })
  })

  it('refuses an empty reason or an unnamed aggregator', () => {
    // The whole mechanism is the reason. An empty one is the bare boolean again.
    expect(() => quietSession('')).toThrow(/non-empty reason/)
    expect(() => quietSession('   ')).toThrow(/non-empty reason/)
    expect(() => absorbedSession('')).toThrow(/named aggregator/)
  })

  it('inherits origin and depth so a declaration does not reset provenance', () => {
    const base = { origin: { kind: 'interactive' as const, userId: 'user_1' }, depth: 3 }
    const session = quietSession('a reason', base)
    expect(session.origin).toEqual(base.origin)
    expect(session.depth).toBe(3)
  })

  it('is narrower than the silent LANE — a silent ORIGIN is not a declaration', () => {
    // `isDeclaredSilent` gates the field-value layer, and it must stay narrower
    // than `sessionLane`. A sync or seed ORIGIN is silent too, but it has never
    // gated that layer; widening this to the whole lane would change behavior
    // for every sync and seed write, which Phase B is explicitly not doing.
    const seed = seedSession('reshape')
    expect(sessionLane(seed)).toBe('silent')
    expect(isDeclaredSilent(seed)).toBe(false)
  })
})
