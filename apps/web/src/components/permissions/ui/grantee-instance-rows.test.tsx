// apps/web/src/components/permissions/ui/grantee-instance-rows.test.tsx

import { ResourcePermission } from '@auxx/database/enums'
import { Level } from '@auxx/lib/permissions/client'
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

beforeAll(() => {
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
      <GranteeInstanceRows
        rows={ROWS}
        canEdit
        isUser
        areaLevel={Level.Read}
        areaLabel='Workflows'
        onChange={vi.fn()}
        {...props}
      />
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
      isUser: false,
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
   */
  it('marks an explicit No-access row on a None-area member', () => {
    renderRows({
      areaLevel: Level.None,
      rows: [{ key: 'workflow', id: 'wf_1', name: 'Order intake', grantLevel: 'none' }],
    })

    expect(document.querySelector('svg.lucide-triangle-alert')).toBeTruthy()
  })

  it('leaves a POSITIVE grant on a None-area member unmarked', () => {
    renderRows({
      areaLevel: Level.None,
      rows: [
        { key: 'workflow', id: 'wf_1', name: 'Order intake', grantLevel: ResourcePermission.view },
      ],
    })

    expect(document.querySelector('svg.lucide-triangle-alert')).toBeNull()
  })

  it('never marks a team, whose area level this component does not model', () => {
    renderRows({
      isUser: false,
      areaLevel: Level.None,
      rows: [{ key: 'workflow', id: 'wf_1', name: 'Order intake', grantLevel: 'none' }],
    })

    expect(document.querySelector('svg.lucide-triangle-alert')).toBeNull()
  })
})
