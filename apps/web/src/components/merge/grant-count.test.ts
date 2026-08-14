// apps/web/src/components/merge/grant-count.test.ts

import { ResourceGranteeType, type Rung } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { countGrantedActors } from './grant-count'

const row = (granteeType: ResourceGranteeType, rung: Rung) => ({ granteeType, rung })

describe('countGrantedActors (merge-dialog grant warning)', () => {
  it('counts user and group grants', () => {
    expect(
      countGrantedActors([
        row(ResourceGranteeType.user, 'read'),
        row(ResourceGranteeType.group, 'edit'),
        row(ResourceGranteeType.user, 'admin'),
      ])
    ).toBe(3)
  })

  it('returns 0 when the target has no grants', () => {
    expect(countGrantedActors([])).toBe(0)
  })

  it('excludes the workspace baseline role row — it is a floor, not a share', () => {
    expect(
      countGrantedActors([
        row(ResourceGranteeType.role, 'read'),
        row(ResourceGranteeType.user, 'read'),
      ])
    ).toBe(1)
  })

  it("excludes 'none' rung rows — a restriction marker never grants access", () => {
    expect(
      countGrantedActors([
        row(ResourceGranteeType.user, 'none'),
        row(ResourceGranteeType.group, 'read'),
      ])
    ).toBe(1)
  })
})
