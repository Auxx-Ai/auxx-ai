// apps/web/src/components/permissions/ui/profile-area-grid.test.tsx

import { AREA_ORDER, Area, Level } from '@auxx/lib/permissions/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ProfileAreaGrid } from './profile-area-grid'
import { AGENT_POLICY_AREA_GROUPS, PROFILE_AREA_GROUPS } from './profile-copy'

/**
 * Plan 29 §5 bar 5 — **the human surfaces are unchanged.**
 *
 * Plan 29 adds four props to `ProfileAreaGrid` (`areaGroups`, `unsetHintFor`,
 * optional `seat`/`roleDefaults`, `onAreaOpenChange`) so the agent policy can
 * render on the same grid. §3 promises each one defaults to today's behaviour,
 * which is a promise about ABSENCE — so these tests render the profile editor's
 * own call, passing none of them, and pin what comes out.
 *
 * The one precedence rule the new `unsetHintFor` must not break is the seat
 * lock: a field seat's ceiling is a fact about what reaches a holder, not a
 * statement about fall-through, so no caller may talk over it.
 */

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

const ROW = 'div[class*="group/tree-row"]'
const TITLE = 'span.truncate.px-1.text-foreground'
/** `LevelControl`'s muted fall-through hint. */
const HINT = 'span.text-xs.text-muted-foreground.whitespace-nowrap'

function allRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ROW))
}

function titleOf(row: HTMLElement): string {
  return row.querySelector(TITLE)?.textContent?.trim() ?? ''
}

function rowTitles(): string[] {
  return allRows().map(titleOf)
}

function row(title: string): HTMLElement {
  const found = allRows().find((r) => titleOf(r) === title)
  if (!found) throw new Error(`no row titled "${title}" — on screen: ${rowTitles().join(', ')}`)
  return found
}

/** The visible fall-through hint of a row, or `''` while an explicit level hides it. */
function hintOf(title: string): string {
  const el = row(title).querySelector(HINT)
  if (!el || el.getAttribute('aria-hidden') === 'true') return ''
  return el.textContent?.trim() ?? ''
}

/** The rung the row's ladder highlights, as its `Level` number. */
function checkedRung(title: string): string {
  return (
    row(title).querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('value') ?? ''
  )
}

function isLocked(title: string): boolean {
  return row(title).querySelector('svg.lucide-lock') !== null
}

/** One comparable line per row — title, hint, highlighted rung, lock. */
function digest(): string[] {
  return allRows().map((r) => {
    const title = titleOf(r)
    const hintEl = r.querySelector(HINT)
    const hint = !hintEl || hintEl.getAttribute('aria-hidden') === 'true' ? '' : hintEl.textContent
    const checked =
      r.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('value') ?? ''
    const lock = r.querySelector('svg.lucide-lock') ? 'locked' : ''
    return `${title}|${hint}|${checked}|${lock}`
  })
}

/** A stand-in for the server-supplied USER `ROLE_DEFAULTS` map. */
const ROLE_DEFAULTS = Object.fromEntries(AREA_ORDER.map((area) => [area, Level.Read])) as Record<
  Area,
  Level
>

type GridProps = Parameters<typeof ProfileAreaGrid>[0]

function renderGrid(props: Partial<GridProps> = {}) {
  return render(
    <TooltipProvider>
      <ProfileAreaGrid values={{}} onChange={vi.fn()} {...props} />
    </TooltipProvider>
  )
}

describe('plan 29 §5 bar 5 — the profile-editor call path is unchanged', () => {
  /** Exactly the props `profile-editor.tsx` passes — none of plan 29's additions. */
  const PROFILE_EDITOR_CALL: Partial<GridProps> = {
    values: { [Area.records]: Level.Edit },
    roleDefaults: ROLE_DEFAULTS,
    baseLevel: Level.Read,
    seat: 'full',
    profileRole: 'USER',
    disabled: false,
  }

  it('offers the human area selection when no areaGroups prop is passed', () => {
    renderGrid(PROFILE_EDITOR_CALL)

    const human = PROFILE_AREA_GROUPS.flatMap((group) => group.areas)
    expect(rowTitles()).toHaveLength(human.length)
    // `adminOnly` and `workerOnly` areas stay out of the human grid…
    expect(rowTitles()).not.toContain('Settings')
    expect(rowTitles()).not.toContain('Linked records')
    // …and the agent grouping, which the agent policy passes, would add one.
    expect(AGENT_POLICY_AREA_GROUPS.flatMap((g) => g.areas)).toContain(Area.settings)
  })

  it('renders identically whether the plan 29 defaults are omitted or passed explicitly', () => {
    const bare = renderGrid(PROFILE_EDITOR_CALL)
    const bareDigest = digest()
    bare.unmount()

    renderGrid({
      ...PROFILE_EDITOR_CALL,
      areaGroups: PROFILE_AREA_GROUPS,
      unsetHintFor: undefined,
      onAreaOpenChange: undefined,
    })

    expect(digest()).toEqual(bareDigest)
  })

  it('keeps the human "Not set" hints when no unsetHintFor is passed', () => {
    const withBase = renderGrid(PROFILE_EDITOR_CALL)
    expect(hintOf('Billing')).toBe('Not set · profile default')
    // An explicit level hides the hint entirely.
    expect(hintOf('Records')).toBe('')
    withBase.unmount()

    // No blanket rung: the hint names the role default it really falls through to.
    const asUser = renderGrid({ ...PROFILE_EDITOR_CALL, baseLevel: null })
    expect(hintOf('Billing')).toBe('Not set · no access')
    asUser.unmount()

    renderGrid({ ...PROFILE_EDITOR_CALL, baseLevel: null, profileRole: 'ADMIN' })
    expect(hintOf('Billing')).toBe('Not set · admin default')
  })

  it('locks nothing when no seat is passed, and falls through to None with no roleDefaults', () => {
    renderGrid({ values: {}, onChange: vi.fn() })

    expect(document.querySelector('svg.lucide-lock')).toBeNull()
    expect(isLocked('Records')).toBe(false)
    // No `roleDefaults` and no `baseLevel` ⇒ fail closed at None (`Level.None` is 0).
    expect(checkedRung('Records')).toBe('0')
    expect(row('Records').querySelector('[role="radio"][value="0"]')).not.toBeDisabled()
  })

  it('still expands children when no onAreaOpenChange is passed', async () => {
    const user = userEvent.setup()
    renderGrid({
      ...PROFILE_EDITOR_CALL,
      renderChildren: (area) =>
        area === Area.records ? { matchCount: 0, rows: <div>child row</div> } : undefined,
    })

    expect(screen.queryByText('child row')).not.toBeInTheDocument()
    await user.click(row('Records').querySelector('button[aria-label="Expand"]') as HTMLElement)
    expect(screen.getByText('child row')).toBeInTheDocument()
  })

  it('reports expand state outward only when onAreaOpenChange is passed', async () => {
    const user = userEvent.setup()
    const onAreaOpenChange = vi.fn()
    renderGrid({
      ...PROFILE_EDITOR_CALL,
      onAreaOpenChange,
      renderChildren: (area) =>
        area === Area.records ? { matchCount: 0, rows: <div>child row</div> } : undefined,
    })

    await user.click(row('Records').querySelector('button[aria-label="Expand"]') as HTMLElement)
    expect(onAreaOpenChange).toHaveBeenCalledWith(Area.records, true)

    await user.click(row('Records').querySelector('button[aria-label="Collapse"]') as HTMLElement)
    expect(onAreaOpenChange).toHaveBeenLastCalledWith(Area.records, false)
  })
})

describe('plan 29 §5 bar 5 — the seat lock outranks unsetHintFor', () => {
  it('keeps the Seat ceiling hint on a locked row whatever the caller returns', () => {
    renderGrid({
      values: {},
      onChange: vi.fn(),
      roleDefaults: ROLE_DEFAULTS,
      baseLevel: Level.Full,
      seat: 'worker',
      unsetHintFor: () => 'Default · Full',
    })

    // A field seat can never reach Records: the ceiling clamps it to None, and
    // the hint must say so rather than repeat the caller's fall-through story.
    expect(isLocked('Records')).toBe(true)
    expect(hintOf('Records')).toBe('Seat ceiling')
    expect(checkedRung('Records')).toBe('0')
    expect(row('Records').querySelector('[role="radio"][value="0"]')).toBeDisabled()

    // On an area the seat DOES reach, the caller's hint is honoured.
    expect(isLocked('My schedule')).toBe(false)
    expect(hintOf('My schedule')).toBe('Default · Full')
  })

  it('uses the caller hint on every row when there is no seat to lock', () => {
    renderGrid({
      values: {},
      onChange: vi.fn(),
      baseLevel: Level.Full,
      unsetHintFor: () => 'Default · Full',
    })

    expect(hintOf('Records')).toBe('Default · Full')
    expect(hintOf('My schedule')).toBe('Default · Full')
  })
})

describe('plan 29 §5 bar 5 — areaGroups drives which areas the grid offers', () => {
  it('renders the adminOnly areas when the agent grouping is passed', () => {
    renderGrid({
      values: {},
      onChange: vi.fn(),
      baseLevel: Level.None,
      areaGroups: AGENT_POLICY_AREA_GROUPS,
    })

    expect(rowTitles()).toContain('Settings')
    expect(rowTitles()).toHaveLength(AGENT_POLICY_AREA_GROUPS.flatMap((g) => g.areas).length)
    // `workerOnly` stays out of BOTH selections — an agent holds no seat, so the
    // control would be a lever that does nothing.
    expect(rowTitles()).not.toContain('Linked records')
  })

  it('searches and filters over whatever grouping it was given', async () => {
    const user = userEvent.setup()
    renderGrid({
      values: { [Area.settings]: Level.Full },
      onChange: vi.fn(),
      baseLevel: Level.None,
      areaGroups: AGENT_POLICY_AREA_GROUPS,
    })

    await user.type(screen.getByPlaceholderText('Search areas...'), 'settings')
    // The query matches labels AND descriptions, so other areas may ride along —
    // what matters is that the adminOnly row is searchable at all.
    expect(rowTitles()).toContain('Settings')
    expect(rowTitles()).not.toContain('Billing')

    await user.clear(screen.getByPlaceholderText('Search areas...'))
    await user.click(screen.getByRole('switch'))
    expect(rowTitles()).toEqual(['Settings'])
    expect(within(row('Settings')).getByText('Full')).toBeInTheDocument()
  })
})
