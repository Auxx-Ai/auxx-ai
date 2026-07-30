// apps/web/src/components/permissions/ui/workspace-defaults-tab.test.tsx

import {
  Area,
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  Level,
} from '@auxx/lib/permissions/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { InstanceAreaAccess, InstanceBaselineRow } from '../hooks/use-instance-baseline-rows'

/**
 * Plan 43 §8 item 19 (grid 4 of 4) — **the Workspace defaults tab.**
 *
 * The awkward grid, and the reason it is worth its own file. This tab is not an
 * area grid at all: it is a tree of resource-type COLLECTIONS, and it
 * deliberately carries no area-level control because the grid that used to live
 * here wrote through `setGranteeLevels` and could reach a state
 * `savePermissionProfile` refuses.
 *
 * §5.2 still wants the access row on all four grids, and the reason applies here
 * more than anywhere: every `Inherit · <rung>` in these collections points at the
 * area rung, and the rung was not on the screen. So the row renders **read-only**
 * — same value as the other three grids, no new write path. These tests pin both
 * halves; making it editable to "finish the job" has to delete the second one.
 */

const h = vi.hoisted(() => ({
  rowsByKey: {} as Record<InstanceAccessKey, InstanceBaselineRow[]>,
  areaAccessByKey: {} as Record<InstanceAccessKey, InstanceAreaAccess>,
}))

vi.mock('../hooks/use-def-baselines', () => ({
  useDefBaselines: () => ({ isLoading: false, rows: [], setBaseline: vi.fn() }),
}))
vi.mock('../hooks/use-instance-baseline-rows', () => ({
  useInstanceBaselineRows: () => ({
    isLoading: false,
    lists: Object.fromEntries(
      INSTANCE_ACCESS_KEYS.map((key) => [key, { items: [], isLoading: false, truncated: false }])
    ),
    rowsByKey: h.rowsByKey,
    areaAccessByKey: h.areaAccessByKey,
    setBaseline: vi.fn(),
  }),
}))
vi.mock('./instance-share-body', () => ({
  InstanceShareBody: () => <div data-testid='share-body' />,
}))

import { WorkspaceDefaultsTab } from './workspace-defaults-tab'

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

function seed(overrides: Partial<Record<InstanceAccessKey, Level>> = {}) {
  h.rowsByKey = Object.fromEntries(INSTANCE_ACCESS_KEYS.map((key) => [key, []])) as Record<
    InstanceAccessKey,
    InstanceBaselineRow[]
  >
  h.areaAccessByKey = Object.fromEntries(
    INSTANCE_ACCESS_KEYS.map((key) => [
      key,
      {
        area: INSTANCE_ACCESS_RESOURCES[key].area,
        value: overrides[key],
        inherited: Level.None,
      } satisfies InstanceAreaAccess,
    ])
  ) as Record<InstanceAccessKey, InstanceAreaAccess>
}

function renderTab() {
  return render(
    <TooltipProvider>
      <WorkspaceDefaultsTab />
    </TooltipProvider>
  )
}

/** Expand one collection row by its label. */
async function openCollection(user: ReturnType<typeof userEvent.setup>, label: string) {
  const row = screen.getByText(label).closest('div[class*="group/tree-row"]') as HTMLElement
  const chevron = row.querySelector<HTMLElement>('button[aria-label="Expand"]')
  if (chevron) await user.click(chevron)
}

function accessTrigger(title: string): HTMLElement {
  const row = screen.getByText(title).closest('div[class*="group/tree-row"]') as HTMLElement
  return within(row).getByRole('combobox')
}

describe('plan 43 §8 item 19 (grid 4 of 4) — the access row heads each collection', () => {
  it('shows the Member profile’s rung, the same value the other grids show', async () => {
    const user = userEvent.setup()
    seed({ dataset: Level.Edit })
    renderTab()

    await openCollection(user, 'Datasets')
    expect(accessTrigger('Dataset access').textContent).toBe('Read and write')
  })

  it('names its fall-through when the profile stores nothing', async () => {
    const user = userEvent.setup()
    seed()
    renderTab()

    await openCollection(user, 'Signatures')
    expect(accessTrigger('Signature access').textContent).toBe('Inherit · No access')
  })

  it('renders it for every collection except personal inboxes', async () => {
    const user = userEvent.setup()
    seed()
    renderTab()

    await openCollection(user, 'Inboxes')
    expect(screen.getByText('Inbox access')).toBeInTheDocument()

    // A personal mailbox has no workspace default, and `Area.inboxes`' own copy
    // says personal mailboxes are never covered by the rung — so an "Inbox
    // access" row heading that collection would contradict itself.
    await openCollection(user, 'Personal inboxes')
    expect(screen.getAllByText('Inbox access')).toHaveLength(1)
  })
})

describe('plan 43 §5.2 — the tab’s access row is READ-ONLY', () => {
  it('disables the control rather than opening a second write path', async () => {
    const user = userEvent.setup()
    seed({ dataset: Level.Edit })
    renderTab()

    await openCollection(user, 'Datasets')
    // This tab has no escalation guard behind it (see `WorkspaceDefaultsTab`'s
    // own doc comment). Showing the value costs nothing; writing it would
    // reintroduce the path that comment records as removed.
    expect(accessTrigger('Dataset access')).toBeDisabled()
  })

  it('carries a description explaining where the rung IS set', async () => {
    const user = userEvent.setup()
    seed()
    renderTab()

    await openCollection(user, 'Datasets')
    const row = screen.getByText('Dataset access').closest('div[class*="group/tree-row"]')
    // `TreeRow` renders `description` as a hover-only `TooltipExplanation`, so
    // the sentence itself is not in the DOM — its trigger is. The wording is
    // pinned by `area-access-copy.test.ts`; what this file owns is that a
    // read-only control is never left standing without one.
    expect(row?.querySelector('svg.lucide-circle-question-mark')).not.toBeNull()
  })

  it('never renders an area ladder — this tab still has no area-level grid', () => {
    seed()
    renderTab()

    expect(document.querySelector('[role="radio"]')).toBeNull()
  })
})

describe('plan 43 §5.2 — the converted set is derived, not listed', () => {
  it('covers eight areas across nine resource keys', () => {
    // `inbox` and `personal_inbox` share `Area.inboxes`, which is why "the nine
    // resources" render eight access rows. A hand-written list of areas would
    // drift from the registry the way #1361's `ALWAYS_OPEN` maps did.
    const areas = new Set(INSTANCE_ACCESS_KEYS.map((k) => INSTANCE_ACCESS_RESOURCES[k].area))
    expect(INSTANCE_ACCESS_KEYS).toHaveLength(9)
    expect(areas.size).toBe(8)
    expect(areas.has(Area.inboxes)).toBe(true)
  })
})
