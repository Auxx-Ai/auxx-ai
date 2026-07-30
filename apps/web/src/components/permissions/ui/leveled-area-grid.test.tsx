// apps/web/src/components/permissions/ui/leveled-area-grid.test.tsx

import {
  Area,
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  Level,
  PERMISSION_AREAS,
} from '@auxx/lib/permissions/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AREA_ACCESS_ROW_COPY } from './area-access-copy'
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
  // Plan 43's access child row is a Radix Select, which drives itself off
  // pointer capture — unimplemented in jsdom.
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
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

/**
 * Plan 43 §8 items 17 and 19 (grid 2 of 4) — **the grantee-overrides tab.**
 *
 * `GranteeOverridesTab` renders THIS grid, not `ProfileAreaGrid`, so the
 * conversion has to land here independently or the access row appears on one
 * screen and vanishes on another — §5.2 calls that outcome worse than today. The
 * set of converted areas is derived from `INSTANCE_ACCESS_RESOURCES` in one
 * place precisely so the two grids cannot disagree; these tests are what would
 * fail if someone re-listed it by hand.
 */

const ROW = 'div[class*="group/tree-row"]'
const ROW_TITLE = 'span.truncate.px-1.text-foreground'

function areaRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ROW))
}

function rowFor(title: string): HTMLElement {
  const found = areaRows().find((r) => r.querySelector(ROW_TITLE)?.textContent?.trim() === title)
  if (!found) throw new Error(`no row titled "${title}"`)
  return found
}

/** Expand one area row through its chevron, then hand back its access-row trigger. */
async function openAccess(
  user: ReturnType<typeof userEvent.setup>,
  area: Area
): Promise<HTMLElement> {
  const chevron = rowFor(PERMISSION_AREAS[area].label).querySelector<HTMLElement>(
    'button[aria-label="Expand"]'
  )
  if (chevron) await user.click(chevron)
  const label = AREA_ACCESS_ROW_COPY[area]?.label
  if (!label) throw new Error(`no access-row copy for ${area}`)
  return within(rowFor(label)).getByRole('combobox')
}

const INSTANCE_AREAS = [
  ...new Set(INSTANCE_ACCESS_KEYS.map((key) => INSTANCE_ACCESS_RESOURCES[key].area)),
]

describe('plan 43 §8 item 17 — this grid converts the same eight areas', () => {
  it('drops the ladder from every instance-access area and keeps it on Records', () => {
    renderGrid()

    for (const area of INSTANCE_AREAS) {
      const label = PERMISSION_AREAS[area].label
      expect(rowFor(label).querySelector('[role="radio"]')).toBeNull()
    }
    expect(rowFor('Records').querySelector('[role="radio"]')).not.toBeNull()
  })

  it('states the resolved rung as text on the collapsed header', () => {
    renderGrid({ baseline: { [Area.datasets]: Level.Edit } })

    expect(within(rowFor('Datasets')).getAllByText('Edit').length).toBeGreaterThan(0)
  })
})

describe('plan 43 §8 item 19 (grid 2 of 4) — the access row writes levels[area]', () => {
  it('shows the same value the profile editor would for the same levels map', async () => {
    const user = userEvent.setup()
    renderGrid({ values: { [Area.signatures]: Level.Full } })

    // The private three's own vocabulary: "Full access" on a signatures row would
    // claim access to every signature, which the rung does not grant.
    expect((await openAccess(user, Area.signatures)).textContent).toBe('Create')
  })

  it('emits through the grid onChange, keyed to the area', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderGrid({ onChange })

    await user.click(await openAccess(user, Area.dashboards))
    await user.click(await screen.findByRole('option', { name: /Create/ }))

    expect(onChange).toHaveBeenCalledWith(Area.dashboards, Level.Full)
  })

  it('keeps the raise-only "ignored" signal, which the ladder used to carry', () => {
    // An override at or below the member baseline is composed away server-side.
    // Losing this on eight rows would make the grid silently pretend the write
    // did something.
    renderGrid({
      mode: 'override',
      baseline: { [Area.datasets]: Level.Full },
      values: { [Area.datasets]: Level.Read },
    })

    expect(rowFor('Datasets').querySelector('svg.lucide-triangle-alert')).not.toBeNull()
  })
})
