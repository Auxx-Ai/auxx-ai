// apps/web/src/components/permissions/ui/leveled-area-grid.test.tsx

import { Area, Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LeveledAreaGrid } from './leveled-area-grid'

/**
 * The area rows' **effective-access line** — plan 31 §2.5 extended one level up.
 *
 * The plan names the read-vs-enforcement gap only for instance rows (finding 4).
 * The same gap exists on the area rows and is arguably worse, because they had
 * no way to show it at all: the ladder renders `values[area] ?? inherited`, where
 * `inherited` is the member profile's base, while real composition is
 * `min(min(max(profileBase, maxOverGroups, userLevel), profileCeiling), seatCeiling)`.
 * A member raised into an area by a team read "Inherit · No access" here while
 * reaching it fine.
 *
 * `effectiveLevels` is additive: absent ⇒ exactly today's behaviour. That matters
 * because this grid is shared by member detail, group detail and the overrides
 * tab, and plan 29 §4 is explicit that widening a shared grid's props means
 * auditing every consumer. These tests pin the absent case first.
 */

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

const ROLE_DEFAULTS = Object.fromEntries(
  Object.keys(PERMISSION_AREAS).map((area) => [area, Level.None])
) as Record<Area, Level>

const WORKFLOWS_LABEL = PERMISSION_AREAS[Area.workflows].label

function renderGrid(props: Partial<React.ComponentProps<typeof LeveledAreaGrid>> = {}) {
  return render(
    <TooltipProvider>
      <LeveledAreaGrid
        mode='override'
        values={{}}
        roleDefaults={ROLE_DEFAULTS}
        baseline={{}}
        onChange={vi.fn()}
        {...props}
      />
    </TooltipProvider>
  )
}

describe('LeveledAreaGrid — effectiveLevels is additive', () => {
  it('renders no effective line at all when the prop is absent', () => {
    renderGrid()

    expect(screen.getByText(WORKFLOWS_LABEL)).toBeTruthy()
    expect(screen.queryByText(/^Effective ·/)).toBeNull()
  })

  /**
   * A group grantee composes to `null` server-side (it is a level SOURCE, not a
   * subject), so its host passes `effective?.areas` = `undefined`. Same path as
   * above, stated separately because it is the case a future refactor is most
   * likely to "helpfully" fill in.
   */
  it('renders no effective line for a grantee with no composed access', () => {
    renderGrid({ effectiveLevels: undefined })

    expect(screen.queryByText(/^Effective ·/)).toBeNull()
  })
})

describe('LeveledAreaGrid — the line reports EVERY area it has a level for', () => {
  it('shows the composed level when it exceeds what the ladder displays', () => {
    // The member's own row says nothing and their profile base is None, so the
    // ladder reads "No access" — but a team raised them to Edit.
    renderGrid({ effectiveLevels: { [Area.workflows]: Level.Edit } })

    expect(screen.getByText('Effective · Edit')).toBeTruthy()
  })

  /**
   * Agreement is still reported. The line used to be suppressed here, which made
   * its absence say two things at once — "the ladder is the truth on this row"
   * and "this surface has no effective access to report at all" (teams, above).
   */
  it('shows the composed level when it agrees with the ladder', () => {
    // `value` is undefined, `inherited` falls through to roleDefaults = None,
    // and composition also lands on None.
    renderGrid({ effectiveLevels: { [Area.workflows]: Level.None } })

    expect(screen.getByText('Effective · No access')).toBeTruthy()
  })

  it('shows the composed level when an explicit override already displays it', () => {
    renderGrid({
      values: { [Area.workflows]: Level.Full },
      effectiveLevels: { [Area.workflows]: Level.Full },
    })

    expect(screen.getByText('Effective · Full')).toBeTruthy()
  })

  /**
   * The downward direction, which no other affordance on this row can express:
   * the grant says Full, the seat ceiling (or a profile ceiling) closes the area,
   * and the ladder happily shows Full.
   */
  it('shows the composed level when a ceiling clamps BELOW the granted rung', () => {
    renderGrid({
      values: { [Area.workflows]: Level.Full },
      effectiveLevels: { [Area.workflows]: Level.None },
    })

    expect(screen.getByText('Effective · No access')).toBeTruthy()
  })

  /**
   * Sparse in, sparse out: an area missing from `effectiveLevels` still renders
   * no line, so a partial map never invents a rung for the areas it omits.
   */
  it('reports per area, and only for the areas it was given', () => {
    renderGrid({
      effectiveLevels: { [Area.workflows]: Level.Read, [Area.dashboards]: Level.None },
    })

    expect(screen.getAllByText(/^Effective ·/)).toHaveLength(2)
    expect(screen.getByText('Effective · Read')).toBeTruthy()
    expect(screen.getByText('Effective · No access')).toBeTruthy()
  })
})
