// apps/web/src/components/permissions/ui/area-access-copy.test.ts

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Area, Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { describe, expect, it } from 'vitest'
import { AREA_ACCESS_ROW_COPY, areaRungHelper, areaRungLabel } from './area-access-copy'
import { INSTANCE_ROW_COPY, INSTANCE_SHARE_COPY } from './instance-share-copy'
import { RUNG_LABELS_LONG } from './level-labels'

/**
 * **The copy lint** (plan 43 §8 item 26).
 *
 * Every phrase banned here was TRUE before §0.2a and is false after it. Decision
 * C settled that an area rung gates the **workspace default** and nothing else —
 * an individual grant always overrules it — so no string may claim a rung closes
 * a feature, and no baseline hint may claim the workspace default reaches
 * everyone.
 *
 * A lint over the copy maps is worth more than three separate render tests: it
 * catches a regression wherever it is written, including in an area or resource
 * added after this plan.
 */

const BANNED = [
  // "None closes signatures entirely" — the phrasing an earlier draft of §2.1
  // carried. Under C, `None` closes the workspace default only.
  { label: 'closes', pattern: /closes/i },
  { label: 'entirely', pattern: /\bentirely\b/i },
  // The workspace default reaches only members whose area rung admits it.
  { label: 'everyone in the workspace', pattern: /everyone in the workspace/i },
]

/** The eight areas that render a synthetic access child row (§2.1). */
const ACCESS_AREAS = [
  Area.signatures,
  Area.snippets,
  Area.dashboards,
  Area.datasets,
  Area.knowledgeBase,
  Area.workflows,
  Area.agents,
  Area.inboxes,
] as const

/** The three whose rung labels override `RUNG_LABELS_LONG` (§2.1a, decision 0.11). */
const PRIVATE_AREAS = [Area.signatures, Area.snippets, Area.dashboards] as const
const SHARED_AREAS = [
  Area.datasets,
  Area.knowledgeBase,
  Area.workflows,
  Area.agents,
  Area.inboxes,
] as const

const ALL_LEVELS = [Level.None, Level.Read, Level.Edit, Level.Full] as const

/**
 * The six `InstanceAccessKey`s whose access has a WORKSPACE DEFAULT for the area
 * rung to gate. `dashboard` belongs here despite `baselineAtCreate: true`: every
 * dashboard is born with a `role:org_member @ view` row, which is exactly the
 * baseline lane C gates (§1.3 — 89 of them in dev).
 */
const ORG_SHARED_KEYS = ['dataset', 'kb', 'dashboard', 'workflow', 'agent', 'inbox'] as const
/** No workspace default exists, so there is nothing for a profile to be shut out of. */
const PRIVATE_KEYS = ['signature', 'snippet', 'personal_inbox'] as const

describe('area access copy — nothing claims a rung closes a feature (§8.26)', () => {
  it('covers exactly the eight instance-access areas, and not records', () => {
    expect(Object.keys(AREA_ACCESS_ROW_COPY).sort()).toEqual([...ACCESS_AREAS].sort())
    expect(AREA_ACCESS_ROW_COPY[Area.records]).toBeUndefined()
  })

  for (const { label, pattern } of BANNED) {
    it(`no row label or description says "${label}"`, () => {
      for (const area of ACCESS_AREAS) {
        const copy = AREA_ACCESS_ROW_COPY[area]
        expect(copy, area).toBeDefined()
        expect(copy?.label, `${area} label`).not.toMatch(pattern)
        expect(copy?.description, `${area} description`).not.toMatch(pattern)
      }
    })

    it(`no rung label or option helper says "${label}"`, () => {
      for (const area of ACCESS_AREAS) {
        for (const level of ALL_LEVELS) {
          expect(areaRungLabel(area, level), `${area}/${level} label`).not.toMatch(pattern)
          expect(areaRungHelper(area, level), `${area}/${level} helper`).not.toMatch(pattern)
        }
      }
    })
  }

  it('keeps §2.0\'s load-bearing "shared directly" clause on the private three', () => {
    // Without it an admin sets `Dashboards: None`, sees a member still holding
    // one dashboard, and files a bug. Do not drop it to save a line.
    for (const area of PRIVATE_AREAS) {
      expect(AREA_ACCESS_ROW_COPY[area]?.description, area).toMatch(/shared with them directly/)
    }
  })

  it('keeps the three sentences that look like padding and are not', () => {
    // The headless-still-fires rule, stated where a user can read it.
    expect(AREA_ACCESS_ROW_COPY[Area.workflows]?.description).toMatch(
      /Scheduled and triggered runs are unaffected/
    )
    expect(AREA_ACCESS_ROW_COPY[Area.agents]?.description).toMatch(/Autonomous runs are unaffected/)
    // One row governs BOTH `inbox` and `personal_inbox`; nothing else on screen
    // says the rung does not reach colleagues' mail.
    expect(AREA_ACCESS_ROW_COPY[Area.inboxes]?.description).toMatch(/Personal mailboxes/)
  })
})

describe('areaRungLabel — one narrow override over the shared vocabulary (§2.1a)', () => {
  it('falls back to RUNG_LABELS_LONG for the shared five, verbatim', () => {
    for (const area of SHARED_AREAS) {
      for (const level of ALL_LEVELS) {
        expect(areaRungLabel(area, level), `${area}/${level}`).toBe(RUNG_LABELS_LONG[level])
      }
    }
  })

  it('overrides Read → Use and Full → Create for the private three only', () => {
    for (const area of PRIVATE_AREAS) {
      expect(areaRungLabel(area, Level.Read)).toBe('Use')
      expect(areaRungLabel(area, Level.Full)).toBe('Create')
      // `None` stays "No access" everywhere; `Edit` does not arise (§3.1) but
      // must not invent a label if a caller asks.
      expect(areaRungLabel(area, Level.None)).toBe(RUNG_LABELS_LONG[Level.None])
      expect(areaRungLabel(area, Level.Edit)).toBe(RUNG_LABELS_LONG[Level.Edit])
    }
  })

  it('falls back for an area with no access row at all', () => {
    expect(areaRungLabel(Area.records, Level.Full)).toBe(RUNG_LABELS_LONG[Level.Full])
  })
})

describe('areaRungHelper — per-area, replacing the records-worded ACCESS_LEVEL_HELPERS', () => {
  it('gives every area its own helper, and never the records wording (item 2b)', () => {
    for (const area of ACCESS_AREAS) {
      for (const level of ALL_LEVELS) {
        expect(areaRungHelper(area, level), `${area}/${level}`).not.toMatch(/records/i)
      }
    }
    expect(areaRungHelper(Area.datasets, Level.Read)).toBe(
      'Search and use every unrestricted dataset'
    )
  })

  it('covers exactly the rungs the area has, plus No access', () => {
    // Derivation pinned, not a hardcoded count (§8 item 20): the option list
    // comes from `PERMISSION_AREAS[area].rungs`, so a helper must exist for each
    // and for none that the area dropped.
    for (const area of ACCESS_AREAS) {
      const rungs = new Set<Level>([
        Level.None,
        ...PERMISSION_AREAS[area].rungs.map((r) => r.level),
      ])
      for (const level of ALL_LEVELS) {
        const helper = areaRungHelper(area, level)
        if (rungs.has(level)) expect(helper, `${area}/${level}`).not.toBe('')
        else expect(helper, `${area}/${level}`).toBe('')
      }
    }
  })

  it('keeps the two No access phrasings apart, on purpose', () => {
    // Same rule, stated from each class's default. Neither says "closes".
    for (const area of PRIVATE_AREAS) {
      expect(areaRungHelper(area, Level.None), area).toBe(
        'The workspace default gives them nothing'
      )
    }
    for (const area of SHARED_AREAS) {
      expect(areaRungHelper(area, Level.None), area).toMatch(/shared directly$/)
    }
  })
})

describe('INSTANCE_SHARE_COPY baseline hints (§5.5.1)', () => {
  it('splits all nine keys into org-shared and private with no overlap', () => {
    expect([...ORG_SHARED_KEYS, ...PRIVATE_KEYS].sort()).toEqual(
      Object.keys(INSTANCE_SHARE_COPY).sort()
    )
  })

  it('never says "everyone in the workspace" without the profile qualifier', () => {
    for (const key of ORG_SHARED_KEYS) {
      const hint = INSTANCE_SHARE_COPY[key].baselineHint
      expect(hint, key).not.toMatch(/everyone in the workspace/i)
      expect(hint, key).toMatch(/whose profile allows/)
    }
  })

  it('leaves the private three alone — "Private to …" is true under C', () => {
    for (const key of PRIVATE_KEYS) {
      const hint = INSTANCE_SHARE_COPY[key].baselineHint
      expect(hint, key).toMatch(/^Private to/)
      expect(hint, key).not.toMatch(/whose profile allows/)
    }
  })

  it('no baseline hint claims a feature is closed', () => {
    for (const [key, copy] of Object.entries(INSTANCE_SHARE_COPY)) {
      for (const { label, pattern } of BANNED) {
        expect(copy.baselineHint, `${key} / ${label}`).not.toMatch(pattern)
      }
    }
  })
})

describe('the reach note (§5.5.2)', () => {
  it('is set for exactly the six org-shared keys', () => {
    for (const key of ORG_SHARED_KEYS) {
      expect(INSTANCE_SHARE_COPY[key].baselineReachNote, key).toMatch(
        /^Members whose profile closes .+ are not reached by this\. Share with them directly to override it\.$/
      )
    }
  })

  it('is absent on the private three, where it would be false', () => {
    // They have no workspace default, so no profile can be shut out of one.
    for (const key of PRIVATE_KEYS) {
      expect(INSTANCE_SHARE_COPY[key].baselineReachNote, key).toBeUndefined()
    }
  })
})

describe('INSTANCE_ROW_COPY.baseline.description (§5.5.4)', () => {
  it('no longer promises "every member"', () => {
    const description = INSTANCE_ROW_COPY.baseline.description
    expect(description).not.toMatch(/every member/i)
    expect(description).toMatch(/where their profile allows it/)
  })
})

describe('the Restricted helper claims no admin bypass (§5.5.3)', () => {
  // `effectiveInstanceLevel` has only the `role === 'OWNER' &&
  // !cfg.baselineAtCreate` arm. Doc 19 §5.3 step 10 removed the ADMIN one; plan
  // 36 §0.6 then scoped OWNER's away from the private resources too. The old
  // string was wrong in the DANGEROUS direction — it told an admin a group still
  // had access when it did not.
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/permissions/ui/instance-share-card.tsx'),
    'utf8'
  )

  it('does not render "below and admins" in either place it used to', () => {
    expect(source).not.toContain('Only people below and admins')
    expect(source).not.toContain('below and admins can access it')
  })

  it('renders the honest replacements', () => {
    expect(source).toContain('Only people listed below')
    expect(source).toContain('listed below can access it')
  })
})
