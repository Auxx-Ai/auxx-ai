// apps/web/src/components/permissions/ui/grantee-instance-rows.test.tsx

import { ResourcePermission } from '@auxx/database/enums'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { InstanceGranteeRow } from '../hooks/use-instance-grantee-rows'
import { GranteeInstanceRows } from './grantee-instance-rows'

/**
 * Plan 31 phase 1 — **a grantee row is a leaf.**
 *
 * The finding these pin is a scope leak, not a layout nit: expanding a workflow
 * under Alice's Permissions tab used to mount `InstanceShareBody`, which lists
 * every OTHER grantee on that workflow *and lets you edit and revoke them*. So a
 * page about one member ran three subjects deep — area level (Alice), instance
 * grant (Alice), all grantees (everyone).
 *
 * The rule being enforced (§2.1): *the expand belongs to a row whose subject is
 * everyone, because its children are the exceptions to that row.* These tests
 * therefore assert the ABSENCE of an expand affordance, which is a promise that
 * a future "let's unify the two row components" pass can break silently — §5
 * warns about exactly that. If a shared primitive ever happens, the axis must be
 * `subject`, never a standalone `expandable` boolean.
 *
 * The escape hatch is tested through the REAL `InstanceShareDialog` with only
 * its body stubbed, so the `recordId` handed across the scope switch is checked
 * rather than assumed.
 */

// Radix's Select drives itself off pointer capture, which jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

// The dialog itself is real (it derives its own title from the recordId); only
// its data-fetching body is stubbed, so the recordId that crosses the scope
// switch is observable.
vi.mock('./instance-share-card', () => ({
  InstanceShareCard: ({ recordId }: { recordId: string }) => (
    <div data-testid='share-card'>{recordId}</div>
  ),
}))

const ROWS: InstanceGranteeRow[] = [
  { key: 'workflow', id: 'wf_1', name: 'Order intake', grantLevel: ResourcePermission.view },
  { key: 'workflow', id: 'wf_2', name: 'Refund sweep', grantLevel: undefined },
]

function renderRows(props: Partial<React.ComponentProps<typeof GranteeInstanceRows>> = {}) {
  return render(
    <TooltipProvider>
      <GranteeInstanceRows rows={ROWS} canEdit onChange={vi.fn()} {...props} />
    </TooltipProvider>
  )
}

describe('GranteeInstanceRows — the rows are leaves (§2.1)', () => {
  it('renders no expand affordance on any row', () => {
    renderRows()

    expect(screen.getByText('Order intake')).toBeTruthy()
    expect(screen.getByText('Refund sweep')).toBeTruthy()
    // `TreeRow`'s chevron is the only Expand/Collapse control it renders.
    expect(screen.queryByRole('button', { name: /expand|collapse/i })).toBeNull()
  })

  it('renders no grantee list — nobody else appears on a page about one grantee', () => {
    renderRows()

    // `InstanceShareBody`/`GranteeList`'s own affordances. Their absence is the
    // whole fix: these are what let an admin edit Bob from Alice's screen.
    expect(screen.queryByText(/add people/i)).toBeNull()
    expect(screen.queryByTestId('share-card')).toBeNull()
  })

  it('renders no Shared·N / Restricted badge (§2.2)', () => {
    renderRows()

    expect(screen.queryByText(/^Shared ·/)).toBeNull()
    expect(screen.queryByText('Restricted')).toBeNull()
  })
})

describe('GranteeInstanceRows — the "Manage sharing" escape hatch (§2.3)', () => {
  it('opens the share dialog for the row it was clicked on', async () => {
    const user = userEvent.setup()
    renderRows()

    // Nothing is open until asked — the scope switch is explicit, not ambient.
    expect(screen.queryByTestId('share-card')).toBeNull()

    await user.click(screen.getAllByRole('button', { name: 'Manage sharing' })[1])

    // The SECOND row's id, not the first — proves the hoisted dialog is keyed to
    // the clicked row rather than to whichever row rendered first.
    expect(screen.getByTestId('share-card').textContent).toBe('workflow:wf_2')
    expect(screen.getByText('Share workflow')).toBeTruthy()
  })

  it('mounts one dialog for the whole list, not one per row', async () => {
    const user = userEvent.setup()
    renderRows()

    await user.click(screen.getAllByRole('button', { name: 'Manage sharing' })[0])

    expect(screen.getAllByTestId('share-card')).toHaveLength(1)
    expect(screen.getByTestId('share-card').textContent).toBe('workflow:wf_1')
  })
})

describe('GranteeInstanceRows — truncation (§2.6, finding 5)', () => {
  it('says so when more instances exist than were listed', () => {
    renderRows({ truncated: true })

    expect(screen.getByText(/Showing the first page only/)).toBeTruthy()
  })

  it('stays silent when the list is complete', () => {
    renderRows()

    expect(screen.queryByText(/Showing the first page only/)).toBeNull()
  })

  it('says so alongside the empty state too — "No matches" on a truncated list is the same lie', () => {
    renderRows({ rows: [], truncated: true })

    expect(screen.getByText('No matches')).toBeTruthy()
    expect(screen.getByText(/Showing the first page only/)).toBeTruthy()
  })
})

describe('GranteeInstanceRows — the effective line (§2.5, finding 4)', () => {
  /**
   * The case the line exists for: a user-level `none` LOSES to a group's `view`
   * (`instanceAccess` is `max` by `PERMISSION_RANK`, `none` ranked 0). Today the
   * admin sets No access, sees the select change, and is told nothing.
   */
  it("reports the composed level even when it contradicts the grantee's own row", () => {
    renderRows({
      rows: [
        {
          key: 'workflow',
          id: 'wf_1',
          name: 'Order intake',
          grantLevel: 'none',
          effectiveLevel: ResourcePermission.view,
        },
      ],
    })

    expect(screen.getByText('Effective · Read')).toBeTruthy()
  })

  it('spells out "No access" rather than hiding the line', () => {
    renderRows({
      rows: [
        {
          key: 'workflow',
          id: 'wf_1',
          name: 'Order intake',
          grantLevel: undefined,
          effectiveLevel: null,
        },
      ],
    })

    expect(screen.getByText('Effective · No access')).toBeTruthy()
  })

  it('renders no line for a group/profile, which has no effective access', () => {
    renderRows({
      rows: [
        {
          key: 'workflow',
          id: 'wf_1',
          name: 'Order intake',
          grantLevel: ResourcePermission.view,
          effectiveLevel: undefined,
        },
      ],
    })

    expect(screen.queryByText(/^Effective ·/)).toBeNull()
  })
})

describe('GranteeInstanceRows — the dead-grant warning survived the change (§B.2.8)', () => {
  /**
   * Plan 25 §2 left exactly one inert row shape: an explicit `none` on a member
   * who already composes the area to `None`. A positive grant on such a member is
   * a REAL single-instance share, so warning about it would now be wrong.
   *
   * Plan 33 §3 moved the "does this apply at all" half to the HOST — `isUser` +
   * `areaLevel` + `areaLabel` existed only to compute one string from two inputs
   * the host already held. What stayed here is the per-ROW half, which is the
   * half plan 25 §2 narrowed.
   */
  const TOOLTIP = 'No effect — their profile already has no Workflows access to take away.'

  it('marks an explicit No-access row when the host says the warning applies', () => {
    renderRows({
      deadGrantTooltip: TOOLTIP,
      rows: [{ key: 'workflow', id: 'wf_1', name: 'Order intake', grantLevel: 'none' }],
    })

    expect(document.querySelector('svg.lucide-triangle-alert')).toBeTruthy()
  })

  it('leaves a POSITIVE grant unmarked even then', () => {
    renderRows({
      deadGrantTooltip: TOOLTIP,
      rows: [
        { key: 'workflow', id: 'wf_1', name: 'Order intake', grantLevel: ResourcePermission.view },
      ],
    })

    expect(document.querySelector('svg.lucide-triangle-alert')).toBeNull()
  })

  it('marks nothing when the host says the concept does not apply', () => {
    // A team or a profile: no composed area level of their own to be inert
    // against, so the host hands in no tooltip at all.
    renderRows({
      rows: [{ key: 'workflow', id: 'wf_1', name: 'Order intake', grantLevel: 'none' }],
    })

    expect(document.querySelector('svg.lucide-triangle-alert')).toBeNull()
  })
})

/**
 * Plan 33 phase 3 — the props the agent policy needs before its own instance-row
 * file is deleted (phase 4).
 */
describe('GranteeInstanceRows — the shared-component props (plan 33 §3)', () => {
  const LEADING = <div data-testid='leading'>All workflows</div>

  it('renders the leading row above the list', () => {
    renderRows({ leadingRow: LEADING })

    const leading = screen.getByTestId('leading')
    const first = screen.getByText('Order intake')
    expect(leading.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the leading row on screen while loading and when empty', () => {
    const { unmount } = renderRows({ rows: [], isLoading: true, leadingRow: LEADING })
    expect(screen.getByTestId('leading')).toBeInTheDocument()
    expect(screen.queryByText('Order intake')).toBeNull()
    unmount()

    renderRows({ rows: [], leadingRow: LEADING })
    expect(screen.getByTestId('leading')).toBeInTheDocument()
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('says what the HOST says when the list is empty', () => {
    renderRows({
      rows: [],
      emptyState: { icon: null, title: 'No workflows', description: 'Nothing to rule on yet.' },
    })

    expect(screen.getByText('No workflows')).toBeInTheDocument()
    expect(screen.queryByText('No matches')).toBeNull()
  })

  it('drops the sharing action, and its dialog, when the surface has no instance to share', () => {
    // An agent policy row authors a PROFILE's rule. There is no grantee list on
    // the other side of it, so offering "manage who else can reach this" would
    // open a dialog about a different subject entirely.
    renderRows({ showSharing: false })

    expect(screen.queryByRole('button', { name: 'Manage sharing' })).toBeNull()
    expect(screen.queryByTestId('share-card')).toBeNull()
  })

  it('renders an orphan row muted, with its own note, and still clearable', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    renderRows({
      onChange,
      rows: [
        {
          key: 'workflow',
          id: 'wf_gone',
          name: 'wf_gone',
          grantLevel: ResourcePermission.none,
          inheritedLevel: ResourcePermission.view,
          inheritLabelText: 'Default',
          isOrphan: true,
        },
      ],
    })

    expect(screen.getByText('wf_gone').className).toContain('text-muted-foreground')
    expect(screen.getByText('Unknown item')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /^Default/ }))
    expect(onChange).toHaveBeenCalledWith('workflow', 'wf_gone', 'inherit')
  })
})
