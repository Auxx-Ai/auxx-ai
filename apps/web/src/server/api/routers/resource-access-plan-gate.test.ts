// apps/web/src/server/api/routers/resource-access-plan-gate.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ROOT } from '../../../test/app-root'

/**
 * Plan-23 §2.1 regression guard: per-def (type-level) record-access EDITING is
 * part of the paid `granularPermissions` feature, enforced server-side in the
 * resourceAccess router — not only hidden by the UI. Mail-infra defs stay free
 * (core product on every plan) and `revokeType` stays ungated (removal only
 * tightens — the `clearGranteeLevels` doctrine).
 *
 * Structural assertions (same style as the retired permissions-member-baseline.test.ts's
 * third block): the router can't be imported under vitest without mocking the
 * whole trpc/session/db stack, so we pin the gate's presence in source.
 */

const src = fs.readFileSync(
  path.resolve(APP_ROOT, 'src/server/api/routers/resourceAccess.ts'),
  'utf8'
)

/**
 * The RECORD plan gate's source, which since plan v3/04 §3.5 lives in lib.
 *
 * It had to move: the approval-decision handler runs in `packages/lib` and also
 * calls `grantInstanceAccess`, so a router-private gate meant a non-Enterprise
 * org could not share a record through the dialog but COULD through an approved
 * access request. Reading the lib file from here keeps the assertion attached to
 * the router that consumes it — a second copy reappearing in either place is
 * exactly what these tests exist to catch.
 */
const guardSrc = fs.readFileSync(
  path.resolve(APP_ROOT, '../../packages/lib/src/resource-access/record-sharing-guard.ts'),
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

/**
 * Plan v3/03 §7.6 / D9 (P5) — **per-RECORD instance sharing is plan-gated**.
 *
 * The handoff's owed follow-up #4: `assertMailSharingFeature` returns early for
 * every non-mail def and `assertTypeAccessEditFeature` only guards the TYPE
 * axis, so a record-def INSTANCE grant took no plan gate at all. Inert while no
 * record share UI existed; P5 mounts one on the drawer and the table row, so
 * the gate lands with it.
 *
 * A client-side `GranularPermissionsGate` around the trigger is not a gate —
 * these assertions are what make the claim true.
 */
describe('resourceAccess RECORD-instance plan gate (plan v3/03 §7.6, D9)', () => {
  it('the helper exempts instance-access resources and mail defs, and gates the rest', () => {
    const from = guardSrc.indexOf('export async function assertRecordSharingFeature')
    expect(from, 'the gate must live in lib (plan v3/04 §3.5)').toBeGreaterThan(-1)
    const helper = guardSrc.slice(from)
    // Datasets / KB / dashboards / inboxes: core product on every plan.
    expect(helper).toContain('isInstanceAccessKey(entityDefinitionId)')
    // Mail keeps its own narrower gate (sub-`read` rungs, NEW Manager rows).
    expect(helper).toContain('isMailSharingDef(entityDefinitionId)')
    expect(helper).toContain('FeatureKey.granularPermissions')
  })

  it('there is exactly ONE implementation — the router keeps no private copy', () => {
    // 🔴 Two copies of a gate that must never disagree is the bug plan v3/04
    // §3.5 closed. A re-added router-local helper would silently re-open the
    // approval-lane bypass, because the approval handler cannot call it.
    expect(src).not.toContain('async function assertRecordSharingFeature')
    expect(src).toContain('assertRecordSharingFeature')
  })

  it('grantInstance and setInstance run it BEFORE the write', () => {
    for (const [proc, libCall] of [
      ['grantInstance:', 'grantInstanceAccess('],
      ['setInstance:', 'setInstanceAccess('],
    ] as const) {
      const body = between(proc, libCall)
      expect(body, `${proc} must plan-gate record sharing before ${libCall}`).toContain(
        'assertRecordSharingFeature(context, recordId)'
      )
    }
  })

  it('the APPROVAL decision handler runs the same gate before granting', () => {
    // The other half of §3.5, and the reason the gate moved at all: an approved
    // record request writes through `grantInstanceAccess` from lib, so without
    // this call a plan-gated org could be granted a record it cannot buy.
    const handler = fs.readFileSync(
      path.resolve(
        APP_ROOT,
        '../../packages/lib/src/approval-requests/record-access-request-mutations.ts'
      ),
      'utf8'
    )
    const decision = handler.slice(
      handler.indexOf('export async function applyRecordAccessDecision')
    )
    const gateAt = decision.indexOf('assertRecordSharingFeature(')
    const grantAt = decision.indexOf('grantInstanceAccess(')
    expect(gateAt, 'the decision handler must run the plan gate').toBeGreaterThan(-1)
    expect(grantAt).toBeGreaterThan(gateAt)
  })

  it('revokeInstance stays ungated — revoking only tightens access', () => {
    expect(between('revokeInstance:', 'revokeInstanceAccess(')).not.toContain(
      'assertRecordSharingFeature'
    )
  })

  it('the record-sharing guard is imported from its DEEP subpath, not the barrel', () => {
    // Plan v3/04 §10.2: the guard moved into lib so the approval-decision handler
    // can re-assert authority inside its transaction. It writes the row-effective
    // read out longhand precisely to avoid the `resources` barrel's dataset/
    // connector service graph — routing the import through the `resource-access`
    // barrel would hand that cost straight back (HANDOFF §5 correction 5).
    expect(src).toContain("from '@auxx/lib/resource-access/record-sharing-guard'")
    expect(src).not.toContain('async function assertCanManageRecordSharing')
  })
})
