// apps/web/src/components/permissions/ui/agent-policy-editor.test.tsx

import type { AgentPermissionPolicy } from '@auxx/database'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_POLICY_INSTANCE_KEYS, type AgentPolicyInstanceKey } from './profile-copy'

/**
 * Plan 29 §5 verification bars 2–4, on the unified tree.
 *
 * The plan collapses three flat sections into ONE `ProfileAreaGrid`, so the
 * question these tests answer is not "does it look right" but **"is every rule
 * that was authorable before still authorable"** — every area, all three
 * collection defaults, the per-def
 * and per-instance rules, and both orphan families. Then: the destructive
 * confirm survived the move, and search/filter still reach child rows.
 *
 * Everything is asserted through the rendered tree rather than the draft hook,
 * because the tree IS the change — `use-agent-policy.test.ts` already covers the
 * data seams.
 */

const h = vi.hoisted(() => ({
  confirm: vi.fn(),
  /** Instance lists, revealed only once their type has been opened at least once. */
  items: {
    dataset: [{ id: 'ds_1', name: 'Sales data' }],
    kb: [{ id: 'kb_1', name: 'Returns Policy' }],
    dashboard: [] as Array<{ id: string; name: string }>,
    workflow: [] as Array<{ id: string; name: string }>,
  } as Record<string, Array<{ id: string; name: string }>>,
  /** Types whose list query has ever been enabled — the react-query cache, modelled. */
  everOpened: new Set<string>(),
  definitionsLoading: false,
  /** A workspace with nothing to rule on — the other half of the empty state. */
  definitionsEmpty: false,
}))

const DEFINITIONS = [
  {
    apiSlug: 'companies',
    entityDefinitionId: 'def_companies',
    label: 'Companies',
    icon: 'building',
    color: 'blue',
  },
  {
    apiSlug: 'deals',
    entityDefinitionId: 'def_deals',
    label: 'Deals',
    icon: 'handshake',
    color: 'green',
  },
]

vi.mock('~/hooks/use-user', () => ({ useUser: () => ({ isAdminOrOwner: true }) }))
vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({ hasAccess: () => true }),
}))
// A viewer who holds everything, so the §2.4a clamp preview reports no reduction
// and the tree is the only thing on screen.
vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({
    capabilities: Object.values(PermissionKey),
    canViewEntity: () => true,
    canEditEntity: () => true,
    canAdministerDef: () => true,
    isLoading: false,
  }),
}))
vi.mock('../hooks/use-agent-policy-save', () => ({
  useAgentPolicySave: () => ({ savePolicy: vi.fn(), isSaving: false }),
}))
vi.mock('../hooks/use-agent-policy-definitions', () => ({
  useAgentPolicyDefinitions: () => ({
    definitions: h.definitionsEmpty ? [] : DEFINITIONS,
    isLoading: h.definitionsLoading,
  }),
}))
// Lazy, exactly like the real hook: a type that has never been marked open has
// fetched nothing, so its instances are not on screen and not searchable. Once
// opened it stays populated, mirroring react-query keeping the cached page when
// the query is disabled again.
vi.mock('../hooks/use-instance-resource-lists', () => ({
  useInstanceResourceLists: (open: Record<string, boolean>) => {
    for (const [type, isOpen] of Object.entries(open)) if (isOpen) h.everOpened.add(type)
    const list = (type: string) => ({
      items: h.everOpened.has(type) ? (h.items[type] ?? []) : [],
      isLoading: false,
      truncated: false,
    })
    // DERIVED from the registry, not hand-listed. The hand-listed version
    // crashed (`Cannot read properties of undefined (reading 'items')`) the
    // moment `signature`/`snippet` joined `AGENT_POLICY_INSTANCE_KEYS` in plan
    // 36 — the editor indexes this map by every key the registry offers, so a
    // missing entry is a crash, not a gap in coverage. `h.items` still names
    // only the types a test actually populates; everything else lists empty.
    return Object.fromEntries(
      AGENT_POLICY_INSTANCE_KEYS.map((type) => [type, list(type)])
    ) as Record<AgentPolicyInstanceKey, ReturnType<typeof list>>
  },
}))
vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [h.confirm, () => null] as const,
}))

import { AgentPolicyEditor } from './agent-policy-editor'

// Radix's Select drives itself off pointer capture, which jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

beforeEach(() => {
  h.everOpened.clear()
  h.definitionsLoading = false
  h.definitionsEmpty = false
  h.confirm.mockReset()
  h.confirm.mockResolvedValue(true)
})

/** One rendered `TreeRow` line — area rows and child rows alike. */
const ROW = 'div[class*="group/tree-row"]'
/** The row's own title slot (`TreeRow`'s `titleNode`), never a group heading. */
const TITLE = 'span.truncate.px-1.text-foreground'

function allRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ROW))
}

function titleOf(row: HTMLElement): string {
  return row.querySelector(TITLE)?.textContent?.trim() ?? ''
}

/** Every row title currently on screen, in document order. */
function rowTitles(): string[] {
  return allRows().map(titleOf)
}

function findRow(title: string): HTMLElement | undefined {
  return allRows().find((row) => titleOf(row) === title)
}

function row(title: string): HTMLElement {
  const found = findRow(title)
  if (!found) throw new Error(`no row titled "${title}" — on screen: ${rowTitles().join(', ')}`)
  return found
}

/** The rung a child row's dropdown currently shows. */
function ruleOf(title: string): string {
  return within(row(title)).getByRole('combobox').textContent?.trim() ?? ''
}

/** Expand (or collapse) one area row through its chevron. */
async function toggleArea(user: UserEvent, title: string) {
  const chevron = row(title).querySelector<HTMLElement>(
    'button[aria-label="Expand"], button[aria-label="Collapse"]'
  )
  if (!chevron) throw new Error(`area row "${title}" is not expandable`)
  await user.click(chevron)
}

/** Choose one option on a child row's rule dropdown. */
async function pick(user: UserEvent, title: string, option: RegExp) {
  await user.click(within(row(title)).getByRole('combobox'))
  await user.click(screen.getByRole('option', { name: option }))
}

/**
 * The resolved rung a CONTROLLESS area header states at its end (`RungBadge`).
 *
 * Distinct from {@link hintOf}: an instance-access header drops the muted
 * fall-through hint entirely (its access row states the same thing, in the
 * control, one row down) and states the resolved rung as a badge instead.
 */
function badgeOf(title: string): string {
  return row(title).querySelector('div.mr-2.whitespace-nowrap')?.textContent?.trim() ?? ''
}

/** An area row's muted fall-through hint (`LevelControl`'s `unsetHint`). */
function hintOf(title: string): string {
  const el = row(title).querySelector('span.text-xs.text-muted-foreground.whitespace-nowrap')
  if (!el || el.getAttribute('aria-hidden') === 'true') return ''
  return el.textContent?.trim() ?? ''
}

/** One of the two header `BaseLevelSelect`s, by its sentence fragment. */
function headerSelect(label: string): HTMLElement {
  const wrapper = screen.getByText(label).parentElement
  if (!wrapper) throw new Error(`no header select labelled "${label}"`)
  return within(wrapper).getByRole('combobox')
}

/** The unsaved-changes bar's rule count, or `null` when the bar is absent. */
function changeCount(): number | null {
  const bar = screen.queryByText(/differ from the saved policy/)
  const match = bar?.textContent?.match(/(\d+) rules? differ/)
  return match ? Number(match[1]) : null
}

/**
 * A policy exercising every keyspace the editor can author, both orphan families
 * included — an override on a record type this workspace does not have
 * (`gone_away`) and one on an item that is not in the fetched list (`kb_gone`).
 */
const FULL_POLICY = {
  areas: { default: 'view', overrides: { records: 'admin', settings: 'admin' } },
  definitions: { default: 'none', overrides: { companies: 'view', gone_away: 'admin' } },
  resources: {
    kb: { default: 'view', overrides: { kb_1: 'admin', kb_gone: 'none' } },
    dataset: { default: 'view', overrides: {} },
  },
} as unknown as AgentPermissionPolicy

function renderEditor(policy: AgentPermissionPolicy | null = FULL_POLICY) {
  return render(
    <TooltipProvider>
      <AgentPolicyEditor profileId='profile_1' savedPolicy={policy} />
    </TooltipProvider>
  )
}

describe('plan 29 §5 bar 2 — every rule reachable before is reachable after', () => {
  it('renders every agent area as a live control', async () => {
    const user = userEvent.setup()
    renderEditor()

    // `Settings` used to be the `adminOnly` area the human grid hid and this one
    // showed. It dropped the flag in plan 39 §7.1 so both grids carry it now —
    // but the agent grid must still offer it, because an agent's authority comes
    // from this policy alone (§2.1) rather than from any role default.
    expect(rowTitles()).toContain('Settings')

    // …and it is a live control, not a read-only mention.
    const settings = row('Settings')
    expect(within(settings).getByText('Full')).toBeInTheDocument()
    await user.click(settings.querySelector('[role="radio"][value="0"]') as HTMLElement)
    expect(
      row('Settings').querySelector('[role="radio"][value="0"]')?.getAttribute('aria-checked')
    ).toBe('true')
    expect(changeCount()).toBe(1)
  })

  it('names the rung the blanket default RESOLVES to on each area, never "not set"', () => {
    renderEditor()

    // An agent row never reads "Not set": the blanket default is one rung for
    // every area at once, so each row names what it resolves to THERE. Billing
    // implements Read, so `areas.default: 'view'` lands on Read…
    expect(hintOf('Billing')).toBe('Default · Read')
    // …while Channels is a Full-only ladder, so the same default composes down to
    // None — and the highlighted segment agrees, which is the whole point (#1342).
    //
    // This used to name `Comments`, which has had a Read rung for as long as the
    // registry has been in git — so the assertion was asserting the opposite of
    // the registry and failing. Any Full-only area proves the clamp; `Channels`
    // is one and has no access row of its own (plan 43), so it still renders the
    // ladder this test reads.
    expect(hintOf('Channels')).toBe('Default · None')
    expect(
      row('Channels').querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('value')
    ).toBe('0')
    // A row with a rule of its own hides the hint entirely.
    expect(hintOf('Records')).toBe('')
  })

  it('offers ONE header collection default, and it is editable', async () => {
    const user = userEvent.setup()
    renderEditor()

    // `areas.default` is the only keyspace left that answers for keys with NO row
    // of their own, so it is the only one that cannot live on a row (§2.2/§4a).
    expect(headerSelect('Unset areas fall through to').textContent).toContain('Read')

    await user.click(headerSelect('Unset areas fall through to'))
    await user.click(screen.getByRole('option', { name: 'Full' }))
    expect(headerSelect('Unset areas fall through to').textContent).toContain('Full')
    expect(changeCount()).toBe(1)
  })

  it('has no second blanket default — a resource type falls through to its own area', async () => {
    const user = userEvent.setup()
    // No `dataset` entry, and `datasets` overridden to `edit`: the "All datasets"
    // row must read the AREA it sits under, not a policy-wide resource rung.
    renderEditor({
      areas: { default: 'none', overrides: { datasets: 'edit' } },
      definitions: { default: 'none', overrides: {} },
      resources: {},
    } as unknown as AgentPermissionPolicy)

    expect(screen.queryByText('New resource types fall through to')).not.toBeInTheDocument()

    await toggleArea(user, 'Datasets')
    // A child could once read "Default · No access" under a Read/Edit parent —
    // the contradiction the second header dropdown made possible (#1362 follow-up).
    expect(ruleOf('All datasets')).toBe('Default · Read and write')
  })

  it('offers definitions.default as the "All record types" child row, and it is editable', async () => {
    const user = userEvent.setup()
    renderEditor()

    // Collapsed: the collection default is not on screen until Records is opened.
    expect(findRow('All record types')).toBeUndefined()

    await toggleArea(user, 'Records')
    expect(ruleOf('All record types')).toBe('No access')

    await pick(user, 'All record types', /^Read and write/)
    expect(ruleOf('All record types')).toBe('Read and write')
    expect(changeCount()).toBe(1)
  })

  it('offers each resource type default as its "All X" child row, and it is editable', async () => {
    const user = userEvent.setup()
    renderEditor()

    await toggleArea(user, 'Knowledge Base')
    expect(ruleOf('All knowledge bases')).toBe('Read only')

    await pick(user, 'All knowledge bases', /^Full access/)
    expect(ruleOf('All knowledge bases')).toBe('Full access')
    expect(changeCount()).toBe(1)
  })

  it('offers per-record-type rules under Records, and they are editable', async () => {
    const user = userEvent.setup()
    renderEditor()
    await toggleArea(user, 'Records')

    // `definitions.overrides.companies`, plus a definition with no rule of its
    // own reading as the collection default it resolves to.
    expect(ruleOf('Companies')).toBe('Read only')
    expect(ruleOf('Deals')).toBe('Default · No access')

    await pick(user, 'Deals', /^Read only/)
    expect(ruleOf('Deals')).toBe('Read only')
    expect(changeCount()).toBe(1)
  })

  it('offers per-instance rules under their area, and they are editable', async () => {
    const user = userEvent.setup()
    renderEditor()
    await toggleArea(user, 'Knowledge Base')

    expect(ruleOf('Returns Policy')).toBe('Full access')

    await pick(user, 'Returns Policy', /^Read only/)
    expect(ruleOf('Returns Policy')).toBe('Read only')
    expect(changeCount()).toBe(1)
  })

  it('keeps both orphan families reachable — unknown record type and unknown item', async () => {
    const user = userEvent.setup()
    renderEditor()

    await toggleArea(user, 'Records')
    const unknownType = row('gone_away')
    expect(within(unknownType).getByText('Unknown type')).toBeInTheDocument()
    expect(ruleOf('gone_away')).toBe('Full access')

    await toggleArea(user, 'Knowledge Base')
    const unknownItem = row('kb_gone')
    expect(within(unknownItem).getByText('Unknown item')).toBeInTheDocument()
    expect(ruleOf('kb_gone')).toBe('No access')

    // Reachable means clearable: an orphan must be removable, since nothing else
    // on the screen can reach a key whose target is gone. Clearing it removes the
    // override, and the row goes with it — the override was the only reason the
    // row existed.
    await pick(user, 'gone_away', /^Default/)
    expect(findRow('gone_away')).toBeUndefined()
    expect(changeCount()).toBe(1)
  })
})

describe('plan 29 §5 bar 3 — the destructive confirm survived the move', () => {
  it("confirms and then drops the type's per-item rules", async () => {
    const user = userEvent.setup()
    h.confirm.mockResolvedValue(true)
    renderEditor()
    await toggleArea(user, 'Knowledge Base')

    await pick(user, 'All knowledge bases', /^Default/)

    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(h.confirm.mock.calls[0][0]).toMatchObject({ destructive: true })
    expect(h.confirm.mock.calls[0][0].description).toContain('2 per-item rules')

    // `clearResourceType` ran: the type entry is gone, so the listed instance
    // falls through to the `Knowledge Base` AREA — `areas.default` (`view`) here,
    // since the policy names no override for it — and the orphan row has nothing
    // left. It reads Read, not None: the child agrees with its parent now.
    expect(ruleOf('All knowledge bases')).toBe('Default · Read only')
    expect(ruleOf('Returns Policy')).toBe('Default · Read only')
    expect(findRow('kb_gone')).toBeUndefined()
    // The type default plus the two per-item rules it took with it.
    expect(changeCount()).toBe(3)
  })

  it('keeps every per-item rule when the confirm is cancelled', async () => {
    const user = userEvent.setup()
    h.confirm.mockResolvedValue(false)
    renderEditor()
    await toggleArea(user, 'Knowledge Base')

    await pick(user, 'All knowledge bases', /^Default/)

    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(ruleOf('All knowledge bases')).toBe('Read only')
    expect(ruleOf('Returns Policy')).toBe('Full access')
    expect(ruleOf('kb_gone')).toBe('No access')
    expect(changeCount()).toBeNull()
  })

  it('does not confirm when the type carries no per-item rules', async () => {
    const user = userEvent.setup()
    renderEditor()
    await toggleArea(user, 'Datasets')

    // `resources.dataset` has a default of its own but an empty override map,
    // so following the area destroys nothing and must not nag.
    await pick(user, 'All datasets', /^Default/)

    expect(h.confirm).not.toHaveBeenCalled()
    expect(ruleOf('All datasets')).toBe('Default · Read only')
    expect(changeCount()).toBe(1)
  })

  it('does not confirm when the "All X" row moves between explicit rungs', async () => {
    const user = userEvent.setup()
    renderEditor()
    await toggleArea(user, 'Knowledge Base')

    await pick(user, 'All knowledge bases', /^Full access/)

    expect(h.confirm).not.toHaveBeenCalled()
    expect(ruleOf('Returns Policy')).toBe('Full access')
    expect(ruleOf('kb_gone')).toBe('No access')
  })
})

describe('plan 29 §5 bar 4 — search and the "Set areas only" filter reach child rows', () => {
  it('keeps and auto-expands an area whose only match is a record type name', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.type(screen.getByPlaceholderText('Search areas...'), 'compan')

    expect(rowTitles()).toContain('Records')
    // Auto-expanded, without anyone clicking the chevron.
    expect(ruleOf('Companies')).toBe('Read only')
    // …and narrowed to the match: the sibling definition is gone.
    expect(findRow('Deals')).toBeUndefined()
    // Areas that matched neither themselves nor a child are gone.
    expect(rowTitles()).not.toContain('Billing')
  })

  it('keeps an area whose only match is an instance name, once that list is fetched', async () => {
    const user = userEvent.setup()
    renderEditor()

    const search = screen.getByPlaceholderText('Search areas...')

    // Before the area is ever opened its list is unfetched, so the instance name
    // matches nothing and the area is filtered away.
    await user.type(search, 'returns')
    expect(rowTitles()).not.toContain('Knowledge Base')

    // Open it once — that is the fetch — then collapse it again.
    await user.clear(search)
    await toggleArea(user, 'Knowledge Base')
    await toggleArea(user, 'Knowledge Base')

    await user.type(search, 'returns')

    // Now the same query keeps the area alive: nothing about the area row itself
    // matched, so only the child rule can have rescued it.
    expect(rowTitles()).toContain('Knowledge Base')
    expect(rowTitles()).not.toContain('Datasets')
    // NOTE: it is NOT auto-expanded here, because an explicit collapse pins the
    // row shut (`openAreas[area] ?? autoOpen` in `ProfileAreaGrid`) — and an
    // instance can only be searchable AFTER its area was opened once. See the
    // report: auto-expand is reachable for definitions (loaded eagerly) but not
    // for instances. This asserts the half of the behaviour that is real.
  })

  it('cannot match inside an area whose list has never been fetched', async () => {
    const user = userEvent.setup()
    renderEditor()

    // The documented tradeoff of the lazy fetch (`onAreaOpenChange`): a collapsed
    // area has queried nothing, so its instances are not searchable yet.
    await user.type(screen.getByPlaceholderText('Search areas...'), 'sales data')

    expect(rowTitles()).not.toContain('Datasets')
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('renders the "All X" row structurally even when it is not itself a match', async () => {
    const user = userEvent.setup()
    renderEditor()
    await toggleArea(user, 'Knowledge Base')

    await user.type(screen.getByPlaceholderText('Search areas...'), 'returns')

    // A child reading "Default · …" is unreadable without the row that says what
    // the default IS, so it always renders — it just does not count as a match.
    expect(ruleOf('All knowledge bases')).toBe('Read only')
    expect(ruleOf('Returns Policy')).toBe('Full access')
    // Its siblings that missed the query are gone, so the "All X" row is not
    // simply riding along on an unfiltered list.
    expect(findRow('kb_gone')).toBeUndefined()
  })

  it('"Set areas only" keeps an area whose only rule is on a child', async () => {
    const user = userEvent.setup()
    // `areas.overrides` says nothing about Records; the only rule under it is the
    // per-definition one.
    renderEditor({
      areas: { default: 'none', overrides: {} },
      definitions: { default: 'none', overrides: { companies: 'view' } },
      resources: {},
    } as unknown as AgentPermissionPolicy)

    await user.click(screen.getByRole('switch'))

    // Records carries no area rule at all — only the child rescues it.
    expect(rowTitles()).toContain('Records')
    expect(rowTitles()).not.toContain('Billing')

    await toggleArea(user, 'Records')
    expect(ruleOf('Companies')).toBe('Read only')
    // Narrowed to rules: the definition with no rule of its own is not shown.
    expect(findRow('Deals')).toBeUndefined()
  })

  it('does not let the mandatory definitions.default pin Records open under "Set areas only"', async () => {
    const user = userEvent.setup()
    renderEditor({
      areas: { default: 'none', overrides: {} },
      definitions: { default: 'view', overrides: {} },
      resources: {},
    } as unknown as AgentPermissionPolicy)

    await user.click(screen.getByRole('switch'))

    // `definitions.default` is stored on every policy, so counting it as a rule
    // would keep Records visible forever and the toggle would mean nothing.
    expect(rowTitles()).not.toContain('Records')
  })

  it('treats an existing resource-type entry as a rule under "Set areas only"', async () => {
    const user = userEvent.setup()
    renderEditor({
      areas: { default: 'none', overrides: {} },
      definitions: { default: 'none', overrides: {} },
      resources: { kb: { default: 'view', overrides: {} } },
    } as unknown as AgentPermissionPolicy)

    await user.click(screen.getByRole('switch'))

    // Unlike `definitions.default`, a type entry is a deliberate departure from
    // the area rung it would otherwise follow — a rule of its own, so it rescues
    // its area.
    expect(rowTitles()).toContain('Knowledge Base')
    expect(rowTitles()).not.toContain('Dashboards')
  })
})

/**
 * Plan 33 phase 2 — the agent rows now go through `GranteeDefAccessRows`, and the
 * empty state moved to the host with them. It had to: the component cannot tell a
 * search that matched nothing from a workspace with nothing in it, because the
 * host is what applies the filter. Before the move it claimed the second in both
 * cases, so typing a miss reported that the workspace had no record types
 * (plan 33 drift #2 — the only one of the four with a user-visible wrong answer).
 */
describe('plan 33 drift #2 — an empty list says which kind of empty it is', () => {
  /**
   * The reachable shape of a search miss, and it is not the obvious one: a query
   * is only handed DOWN to the children when the area's own label missed it
   * (`ProfileAreaGrid` passes `query: selfMatch ? '' : query`), and an area whose
   * children all miss too is dropped entirely. So the one way to see a filtered
   * empty list is a query that matches ONLY the structural "All X" row.
   */
  it('reports a search MISS, not an empty workspace', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.type(screen.getByPlaceholderText('Search areas...'), 'all record')

    expect(screen.getByText('Nothing matches your search.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing to rule on beyond the default above.')).toBeNull()
    // The collection default still renders: it is what an empty list falls
    // through to, so it is needed most exactly when there is nothing below it.
    expect(ruleOf('All record types')).toBe('No access')
  })

  it('reports the "Set areas only" filter, not an empty workspace', async () => {
    const user = userEvent.setup()
    // An area rule keeps Records on screen under the filter; no definition rule
    // means the child list under it comes back empty.
    renderEditor({
      areas: { default: 'view', overrides: { records: 'admin' } },
      definitions: { default: 'none', overrides: {} },
      resources: {},
    } as unknown as AgentPermissionPolicy)

    await user.click(screen.getByRole('switch'))
    await toggleArea(user, 'Records')

    expect(screen.getByText('Nothing here has a rule of its own.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing to rule on beyond the default above.')).toBeNull()
  })

  it('reports a search MISS under an instance area too', async () => {
    const user = userEvent.setup()
    renderEditor()

    // Same shape as the record-type case: only the structural "All X" row
    // matches, so the area survives with an empty child list under it.
    await user.type(screen.getByPlaceholderText('Search areas...'), 'all knowledge')

    expect(screen.getByText('Nothing matches your search.')).toBeInTheDocument()
    expect(screen.queryByText(/^Nothing to rule on yet/)).toBeNull()
    expect(ruleOf('All knowledge bases')).toBe('Read only')
  })

  it('reports an empty workspace when nothing is filtered', async () => {
    const user = userEvent.setup()
    h.definitionsEmpty = true
    renderEditor({
      areas: { default: 'view', overrides: { records: 'admin' } },
      definitions: { default: 'none', overrides: {} },
      resources: {},
    } as unknown as AgentPermissionPolicy)
    await toggleArea(user, 'Records')

    expect(screen.getByText('Nothing to rule on beyond the default above.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing matches your search.')).toBeNull()
  })
})

/**
 * Plan 33 phases 2 + 4 — the agent rows are now the SAME components the human
 * grantee grids render. Two things had to change with them and two had to not.
 */
describe('plan 33 §1 — the agent rows share the grantee renderers', () => {
  it('grows the resource-type icon on instance rows (D3)', async () => {
    const user = userEvent.setup()
    renderEditor()
    await toggleArea(user, 'Knowledge Base')

    // The agent instance rows had no icon at all; the shared row draws
    // `INSTANCE_TYPE_META[key].icon`, so a KB row now shows the KB glyph.
    expect(row('Returns Policy').querySelector('svg.lucide-book-open')).toBeTruthy()
  })

  it('badges a row that carries a rule of its own (D2)', async () => {
    const user = userEvent.setup()
    renderEditor()
    await toggleArea(user, 'Records')

    // `definitions.overrides.companies` exists; Deals follows the collection
    // default, so only one of the two is a rule.
    expect(within(row('Companies')).getByText('Override')).toBeInTheDocument()
    expect(within(row('Deals')).queryByText('Override')).toBeNull()
  })

  it('offers NO sharing action — an agent policy has no grantees to manage', async () => {
    const user = userEvent.setup()
    renderEditor()
    await toggleArea(user, 'Knowledge Base')

    // `showSharing` is the discriminant. "Manage who else can reach this" opens a
    // dialog about the INSTANCE's grantees, which is a different subject from the
    // profile rule this row authors.
    expect(screen.queryByRole('button', { name: 'Manage sharing' })).toBeNull()
  })
})

/**
 * Plan 26 Phase 2 — the vocabulary collapse deleted `AgentPolicyLevelSelect`, the
 * wrapper that used to encode these rules, and inlined `AccessLevelSelect` at the
 * six child-row call sites (§2.5a). Two discriminants had to survive that move
 * intact, and both are the kind of thing a "pure rename" quietly breaks.
 */
describe('plan 26 §2.5a — the two select discriminants survive the wrapper deletion', () => {
  it('offers Default on a row that HAS a fall-through, naming the rung it resolves to', async () => {
    const user = userEvent.setup()
    renderEditor()
    await toggleArea(user, 'Records')

    // `definitions.overrides.companies` may be cleared back to the collection
    // default, so the option exists AND states the concrete rung behind it —
    // the word "default" never appears alone on this surface.
    await user.click(within(row('Companies')).getByRole('combobox'))
    const option = screen.getByRole('option', { name: /^Default · No access/ })
    expect(option).toBeInTheDocument()

    await user.click(option)
    expect(ruleOf('Companies')).toBe('Default · No access')
  })

  it('offers NO Default on the mandatory "All record types" row, but keeps None', async () => {
    const user = userEvent.setup()
    renderEditor()
    await toggleArea(user, 'Records')

    await user.click(within(row('All record types')).getByRole('combobox'))
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '')

    // `definitions.default` is mandatory — there is nothing to fall through to,
    // so a Default option would emit a value the store has nowhere to put.
    expect(options.some((text) => text.startsWith('Default'))).toBe(false)
    // …and `None` is a first-class, selectable rung here: for an agent it is a
    // deliberate deny, never "unset" (plan 19 §7). Losing `includeNone` on this
    // row would make a deny unauthorable.
    expect(options.some((text) => text.startsWith('No access'))).toBe(true)
    expect(options).toHaveLength(4)
  })

  it('keeps None selectable on the header defaults and never offers "Member default"', async () => {
    const user = userEvent.setup()
    renderEditor()

    // `BaseLevelSelect` is discriminated on `allowUnset`. `Level.None === 0`, so
    // `String(0)` is a REAL option that must not collapse into the human
    // `member_default` sentinel — an agent's defaults are mandatory and fail
    // closed at None, so the sentinel must be absent while None must be present.
    await user.click(headerSelect('Unset areas fall through to'))
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '')
    expect(options).toEqual(['None', 'Read', 'Edit', 'Full'])

    await user.click(screen.getByRole('option', { name: 'None' }))
    expect(headerSelect('Unset areas fall through to').textContent).toContain('None')
    expect(changeCount()).toBe(1)
  })
})

/**
 * Plan 43 §8 items 17 and 19 (grid 3 of 4) — **the access row on the agent
 * surface.**
 *
 * §5.2 leaves this one open ("decide whether the access row renders there or
 * whether the agent surface keeps the plain ladder"). It renders, and the reason
 * is forced rather than aesthetic: decision 0.7 takes the ladder off the header
 * for every instance-access area on every grid, and the agent's area rung is the
 * `min` each nested rule is clamped against (`resourceTypeAreaLevel`). Keeping
 * the plain ladder here would have been the fifth shape in a plan whose whole
 * point is that there is one; dropping the row would have made the rung
 * unauthorable.
 *
 * `Area.agents` and `Area.inboxes` are already out of `AGENT_POLICY_AREA_GROUPS`,
 * so six of the eight areas reach this surface.
 */
describe('plan 43 §8 item 19 (grid 3 of 4) — the agent policy renders the access row', () => {
  it('carries the area rung on the access row, named "Default" not "Inherit"', async () => {
    const user = userEvent.setup()
    renderEditor()

    await toggleArea(user, 'Knowledge Base')
    // `areas.default` is `view` and KB has no override in FULL_POLICY, so the
    // row falls through and names the rung it resolves to.
    expect(ruleOf('Knowledge base access')).toBe('Default · Read only')
  })

  it('shows an explicit area override on the access row', async () => {
    const user = userEvent.setup()
    renderEditor()

    await toggleArea(user, 'Datasets')
    expect(ruleOf('Dataset access')).toBe('Default · Read only')

    await pick(user, 'Dataset access', /^Full access/)
    expect(ruleOf('Dataset access')).toBe('Full access')
    expect(changeCount()).toBe(1)
  })

  it('leaves the header controlless and states the resolved rung as text', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(row('Datasets').querySelector('[role="radio"]')).toBeNull()
    // Records keeps its ladder — its children are per-DEFINITION (§5.2).
    expect(row('Records').querySelector('[role="radio"]')).not.toBeNull()

    await toggleArea(user, 'Datasets')
    // Raising the access row moves the header's resolved-rung badge with it.
    await pick(user, 'Dataset access', /^Full access/)
    expect(badgeOf('Datasets')).toBe('Full')
    // ...and the muted fall-through hint stays absent on a controlless header.
    expect(hintOf('Datasets')).toBe('')
  })

  it('sits directly above the "All X" row it is the default for', async () => {
    const user = userEvent.setup()
    renderEditor()

    await toggleArea(user, 'Knowledge Base')
    const titles = rowTitles()
    expect(titles.indexOf('Knowledge base access')).toBeGreaterThan(
      titles.indexOf('Knowledge Base')
    )
    expect(titles.indexOf('All knowledge bases')).toBe(titles.indexOf('Knowledge base access') + 1)
  })
})
