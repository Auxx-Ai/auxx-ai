// apps/web/src/components/permissions/ui/profile-area-grid.test.tsx

import {
  AREA_ORDER,
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
  // Radix's Select drives itself off pointer capture, which jsdom does not
  // implement — plan 43's access row is a Select, so the ladder-only suite above
  // now needs the same shims every dropdown suite in this folder installs.
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
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
    // `Settings` is now IN the human grid — it dropped `adminOnly` in plan 39
    // §7.1, and this row appearing is the delegation itself. Before that, the
    // area could be zeroed but never granted, so it read as admin-only either
    // way and the grid hid it.
    expect(rowTitles()).toContain('Settings')
    // `workerOnly` still stays out: a full seat has no use for the linked-records
    // rung, so the control would be a lever that does nothing.
    expect(rowTitles()).not.toContain('Linked records')
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
  it('renders the agent grouping when it is passed', () => {
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
    // what matters is that the row is searchable at all.
    expect(rowTitles()).toContain('Settings')
    expect(rowTitles()).not.toContain('Billing')

    await user.clear(screen.getByPlaceholderText('Search areas...'))
    await user.click(screen.getByRole('switch'))
    expect(rowTitles()).toEqual(['Settings'])
    expect(within(row('Settings')).getByText('Full')).toBeInTheDocument()
  })
})

/**
 * Plan 43 §8 items 17, 18, 20–22 and 24 — **the controlless parent and its
 * access child row.**
 *
 * The defect these pin is not cosmetic. For `signatures` / `snippets` /
 * `dashboards` the parent's ladder asked *"may I create"* while its children
 * asked *"who may use this one"* — unrelated axes wearing the same control and
 * stacked to imply a containment that did not exist. Decision 0.7 gives all
 * eight instance-access areas one shape: header + access child row.
 *
 * **`Area.records` is the control case, and it is load-bearing** (§5.2): its
 * children are per-*definition*, its rung genuinely IS their default, and it
 * keeps the ladder. A "let's finish the unification" pass that converts Records
 * has to delete a failing test to happen.
 */

/** The eight areas that trade their ladder for an access child row. */
const INSTANCE_AREAS = [
  ...new Set(INSTANCE_ACCESS_KEYS.map((key) => INSTANCE_ACCESS_RESOURCES[key].area)),
]

/** The access row's title for an area, from the copy table the row reads. */
function accessRowTitle(area: Area): string {
  const label = AREA_ACCESS_ROW_COPY[area]?.label
  if (!label) throw new Error(`no access-row copy for ${area}`)
  return label
}

/** Whether a row renders a segmented `LevelControl` ladder of its own. */
function hasLadder(title: string): boolean {
  return row(title).querySelector('[role="radio"]') !== null
}

/**
 * Expand one area row through its chevron.
 *
 * The access row is a CHILD, so it is behind the chevron like every other one —
 * which is the cost §2.1b's read-only header summary exists to pay for. Nine of
 * ~15 rows now hide their control, so a collapsed profile has to stay scannable
 * on text alone.
 */
async function expandArea(user: ReturnType<typeof userEvent.setup>, area: Area) {
  const chevron = row(PERMISSION_AREAS[area].label).querySelector<HTMLElement>(
    'button[aria-label="Expand"]'
  )
  if (chevron) await user.click(chevron)
}

/** The access row's dropdown trigger for an already-expanded area. */
function accessTrigger(area: Area): HTMLElement {
  return within(row(accessRowTitle(area))).getByRole('combobox')
}

/** Expand `area` and hand back its access-row trigger. */
async function openAccessRow(
  user: ReturnType<typeof userEvent.setup>,
  area: Area
): Promise<HTMLElement> {
  await expandArea(user, area)
  return accessTrigger(area)
}

/** Open the access row's dropdown and read back its option labels, in order. */
async function accessOptions(
  user: ReturnType<typeof userEvent.setup>,
  area: Area
): Promise<string[]> {
  await user.click(await openAccessRow(user, area))
  const options = await screen.findAllByRole('option')
  // Each option renders `<div class="flex flex-col items-start"><span>label</span>
  // <span>helper</span></div>`; the first span of that stack is the label. The
  // `items-start` class is what distinguishes it from shadcn's own `flex-col`
  // wrapper one level up, whose text is label + helper run together.
  const labelOf = (o: HTMLElement) =>
    o.querySelector('div.items-start > span')?.textContent?.trim() ?? o.textContent?.trim() ?? ''
  return options.map((o) => labelOf(o))
}

const PLAN_43_CALL: Partial<GridProps> = {
  values: {},
  roleDefaults: ROLE_DEFAULTS,
  baseLevel: null,
  seat: 'full',
  profileRole: 'USER',
}

describe('plan 43 §8 item 17 — the parent renders no control for the eight, and still does for Records', () => {
  it('drops the ladder from every instance-access area row', () => {
    renderGrid(PLAN_43_CALL)

    for (const area of INSTANCE_AREAS) {
      const label = PERMISSION_AREAS[area].label
      expect(rowTitles()).toContain(label)
      expect(hasLadder(label)).toBe(false)
    }
  })

  it('keeps the ladder on Records and on the non-instance areas', () => {
    renderGrid(PLAN_43_CALL)

    // The one area whose children are per-DEFINITION, where parent and child ask
    // the same question at different scopes and sharing a ladder is correct.
    expect(hasLadder('Records')).toBe(true)
    expect(hasLadder('Billing')).toBe(true)
    expect(hasLadder('Settings')).toBe(true)
    // …and Records grows no access row.
    expect(rowTitles()).not.toContain('Record access')
  })

  // Eight sequential expands in one render — slow enough to trip vitest's 5s
  // default when the folder's suites run in parallel, so it gets its own budget
  // rather than being narrowed to a sample. Every area is the point: the set is
  // derived, and a derivation is only tested by walking all of it.
  it('renders exactly one access child row per instance-access area', async () => {
    const user = userEvent.setup()
    renderGrid(PLAN_43_CALL)

    for (const area of INSTANCE_AREAS) {
      await expandArea(user, area)
      const title = accessRowTitle(area)
      expect(rowTitles().filter((t) => t === title)).toHaveLength(1)
    }
  }, 20_000)

  it('expands an instance-access area even when the host supplies no child rows', async () => {
    const user = userEvent.setup()
    // `renderChildren` is absent entirely — the access row is the only child, and
    // it is the area's only remaining control, so the chevron must still appear
    // or the rung becomes unreachable.
    renderGrid(PLAN_43_CALL)

    expect(row('Datasets').querySelector('button[aria-label="Expand"]')).not.toBeNull()
    expect(await openAccessRow(user, Area.datasets)).toBeInTheDocument()
  })
})

describe('plan 43 §8 item 18 — the collapsed parent states its resolved rung as text', () => {
  it('spells the bottom rung "No access", never "None"', () => {
    renderGrid({ ...PLAN_43_CALL, values: { [Area.datasets]: Level.None } })

    const datasets = row('Datasets')
    expect(within(datasets).getAllByText('No access').length).toBeGreaterThan(0)
    // "None" would read as a missing value beside a ladder that also has a None
    // rung — `effectiveLevelLabel` exists for exactly this.
    expect(within(datasets).queryByText('None')).toBeNull()
  })

  it('reads the resolved rung, not the stored one, when the area is unset', () => {
    // Nothing stored; the profile's blanket base is Full, so the header reports
    // Full even though `values[datasets]` is undefined.
    renderGrid({ ...PLAN_43_CALL, baseLevel: Level.Full })

    expect(within(row('Datasets')).getAllByText('Full').length).toBeGreaterThan(0)
  })

  it('is text, not a control', () => {
    renderGrid(PLAN_43_CALL)

    // The row's only combobox belongs to the access CHILD row, and the header
    // carries no radio ladder — so the resolved rung is unreachable as an input.
    expect(hasLadder('Datasets')).toBe(false)
  })
})

describe('plan 43 §8 item 19 (grid 1 of 4) — the access row writes levels[area]', () => {
  it('emits the chosen rung through the same onChange the parent used', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderGrid({ ...PLAN_43_CALL, onChange })

    await user.click(await openAccessRow(user, Area.datasets))
    await user.click(await screen.findByRole('option', { name: /Full access/ }))

    expect(onChange).toHaveBeenCalledWith(Area.datasets, Level.Full)
  })

  it('clears the area back to its fall-through when Inherit is chosen', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderGrid({ ...PLAN_43_CALL, values: { [Area.datasets]: Level.Full }, onChange })

    await user.click(await openAccessRow(user, Area.datasets))
    await user.click(await screen.findByRole('option', { name: /^Inherit/ }))

    expect(onChange).toHaveBeenCalledWith(Area.datasets, undefined)
  })
})

describe('plan 43 §8 item 20 — the options derive from PERMISSION_AREAS[area].rungs', () => {
  /**
   * Asserted **per area**, not against one hardcoded number. A single expectation
   * would pass for a hardcoded `[none, view, edit, admin]` list, which is exactly
   * the bug §5.2 exists to prevent — `inboxes` has no `Edit` rung and neither do
   * the plan-43 three after §3.1.
   */
  it.each([
    [Area.datasets, 4],
    [Area.knowledgeBase, 4],
    [Area.workflows, 4],
    [Area.agents, 4],
    [Area.inboxes, 3],
    [Area.signatures, 3],
    [Area.snippets, 3],
    [Area.dashboards, 3],
  ])('offers No access + exactly %s’s own rungs', async (area, expected) => {
    const user = userEvent.setup()
    renderGrid(PLAN_43_CALL)

    const options = await accessOptions(user, area as Area)
    // One `Inherit` plus `No access` plus the area's declared rungs.
    expect(options).toHaveLength(1 + (expected as number))
    expect(options.filter((o) => o.startsWith('Inherit'))).toHaveLength(1)
    expect(1 + PERMISSION_AREAS[area as Area].rungs.length).toBe(expected as number)
  })

  it('offers no Read+write on an area with no Edit rung', async () => {
    const user = userEvent.setup()
    renderGrid(PLAN_43_CALL)

    expect(await accessOptions(user, Area.signatures)).not.toContain('Read and write')
  })

  it('uses the private three’s rung vocabulary, and the shared five keep the ladder’s', async () => {
    const user = userEvent.setup()
    renderGrid(PLAN_43_CALL)

    // "Full access" on a dashboards row asserts access to ALL dashboards —
    // precisely the misconception plan 43 exists to kill. The rung grants
    // creation and nothing else.
    const signatures = await accessOptions(user, Area.signatures)
    expect(signatures).toContain('Use')
    expect(signatures).toContain('Create')
    expect(signatures).not.toContain('Read only')
  })
})

describe('plan 43 §8 item 21 — unset and explicit None are distinguishable in the trigger', () => {
  it('reads "Inherit · <resolved>" while nothing is stored', async () => {
    const user = userEvent.setup()
    renderGrid({ ...PLAN_43_CALL, baseLevel: Level.Read })

    expect((await openAccessRow(user, Area.datasets)).textContent).toBe('Inherit · Read only')
  })

  it('reads "No access" once the area is explicitly closed', async () => {
    const user = userEvent.setup()
    renderGrid({ ...PLAN_43_CALL, baseLevel: Level.Read, values: { [Area.datasets]: Level.None } })

    expect((await openAccessRow(user, Area.datasets)).textContent).toBe('No access')
  })

  it('names the fall-through in the AREA’s vocabulary, not the shared ladder’s', async () => {
    const user = userEvent.setup()
    renderGrid({ ...PLAN_43_CALL, baseLevel: Level.Read })

    // `Inherit · Read only` would be wrong here: `view` on a signature means
    // stamp it on a reply.
    expect((await openAccessRow(user, Area.signatures)).textContent).toBe('Inherit · Use')
  })

  it('honours a caller-supplied fall-through name (the agent policy’s "Default")', async () => {
    const user = userEvent.setup()
    renderGrid({ ...PLAN_43_CALL, baseLevel: Level.Read, accessInheritLabel: 'Default' })

    expect((await openAccessRow(user, Area.datasets)).textContent).toBe('Default · Read only')
  })

  it('clamps a stored rung the area no longer offers rather than reading as unset', async () => {
    const user = userEvent.setup()
    // A legacy `Level.Edit` on `signatures`, whose Edit rung §3.1 dropped. It
    // composes DOWN to Read; rendering it verbatim would match no option and the
    // trigger would silently claim the area was unset.
    renderGrid({ ...PLAN_43_CALL, values: { [Area.signatures]: Level.Edit } })

    expect((await openAccessRow(user, Area.signatures)).textContent).toBe('Use')
  })
})

describe('plan 43 §8 item 22 — the option helpers are per-area', () => {
  it('never says "Can view records" under a dataset row', async () => {
    const user = userEvent.setup()
    renderGrid(PLAN_43_CALL)

    await user.click(await openAccessRow(user, Area.datasets))
    const panel = await screen.findByRole('listbox')
    expect(panel.textContent).toContain('Search and use every unrestricted dataset')
    expect(panel.textContent).not.toContain('Can view records')
  })

  it('states each class’s No-access lane, and never claims the feature is closed', async () => {
    const user = userEvent.setup()
    renderGrid(PLAN_43_CALL)

    await user.click(await openAccessRow(user, Area.signatures))
    const panel = await screen.findByRole('listbox')
    // The private three say the workspace default gives them nothing — something
    // shared directly still reaches them (§0.2a). "Closes signatures entirely"
    // would be false.
    expect(panel.textContent).toContain('The workspace default gives them nothing')
    expect(panel.textContent).not.toMatch(/closes|entirely/i)
  })
})

describe('plan 43 §8 item 24 — the seat lock still locks the whole area', () => {
  it('locks the header and disables the access row beneath it', async () => {
    const user = userEvent.setup()
    renderGrid({ ...PLAN_43_CALL, seat: 'worker', baseLevel: Level.Full })

    // A field seat can never reach datasets: `SEAT_CEILINGS` clamps the AREA to
    // None, not just the create rung.
    expect(isLocked('Datasets')).toBe(true)
    expect(hintOf('Datasets')).toBe('Seat ceiling')
    expect(await openAccessRow(user, Area.datasets)).toBeDisabled()
  })

  it('reports the level that actually reaches a holder, not the authored one', () => {
    renderGrid({ ...PLAN_43_CALL, seat: 'worker', values: { [Area.datasets]: Level.Full } })

    // An explicit Full above the ceiling would never reach anyone, so the header
    // must not advertise it.
    const datasets = row('Datasets')
    expect(within(datasets).getAllByText('No access').length).toBeGreaterThan(0)
  })
})
