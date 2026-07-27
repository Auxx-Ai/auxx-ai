// apps/web/src/server/api/routers/resource-access-plan-gate.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Plan-23 §2.1 regression guard: per-def (type-level) record-access EDITING is
 * part of the paid `granularPermissions` feature, enforced server-side in the
 * resourceAccess router — not only hidden by the UI. Mail-infra defs stay free
 * (core product on every plan) and `revokeType` stays ungated (removal only
 * tightens — the `clearGranteeLevels` doctrine).
 *
 * Structural assertions (same style as permissions-member-baseline.test.ts's
 * third block): the router can't be imported under vitest without mocking the
 * whole trpc/session/db stack, so we pin the gate's presence in source.
 */

const src = fs.readFileSync(
  path.resolve(process.cwd(), 'src/server/api/routers/resourceAccess.ts'),
  'utf8'
)

/** Source between two unique anchors (fails loudly if an anchor moves). */
function between(start: string, end: string): string {
  const from = src.indexOf(start)
  const to = src.indexOf(end, from)
  expect(from, `anchor not found: ${start}`).toBeGreaterThan(-1)
  expect(to, `anchor not found after ${start}: ${end}`).toBeGreaterThan(from)
  return src.slice(from, to)
}

describe('resourceAccess type-level plan gate (plan 23 §2.1)', () => {
  it('the gate helper skips mail defs and requires granularPermissions', () => {
    const helper = between('async function assertTypeAccessEditFeature', 'authorizeInstanceTarget')
    expect(helper).toContain('isMailSharingDef(entityDefinitionId)) return')
    expect(helper).toContain('FeaturePermissionService')
    expect(helper).toContain('FeatureKey.granularPermissions')
  })

  it('grantType and setType run the gate before writing', () => {
    for (const [proc, libCall] of [
      ['grantType:', 'grantTypeAccess('],
      ['setType:', 'setTypeAccess('],
    ] as const) {
      const body = between(proc, libCall)
      expect(body, `${proc} must call the plan gate before ${libCall}`).toContain(
        'assertTypeAccessEditFeature(ctx, input.entityDefinitionId)'
      )
    }
  })

  it('revokeType stays ungated — removal only tightens access', () => {
    expect(between('revokeType:', 'revokeTypeAccess(')).not.toContain('assertTypeAccessEditFeature')
  })

  it('instance-level sharing (the sharing funnel) stays free on every plan', () => {
    for (const [proc, end] of [
      ['grantInstance:', 'grantInstanceAccess('],
      ['setInstance:', 'setInstanceAccess('],
      ['revokeInstance:', 'revokeInstanceAccess('],
    ] as const) {
      expect(between(proc, end)).not.toContain('assertTypeAccessEditFeature')
    }
  })
})
