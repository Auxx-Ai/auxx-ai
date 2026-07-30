// apps/web/src/components/permissions/ui/instance-baseline-rows.test.tsx

import { ResourcePermission } from '@auxx/database/enums'
import { INSTANCE_ACCESS_RESOURCES } from '@auxx/lib/permissions/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { InstanceBaselineRow } from '../hooks/use-instance-baseline-rows'

/**
 * Plan 43 §5.3 and §8 item 23 — **the workspace-baseline picker.**
 *
 * Two claims that pull in opposite directions and both have to hold:
 *
 * 1. **`Inherit` becomes `Private` where it was never anything else** (§5.3).
 *    `use-instance-baseline-rows` hard-codes `inheritedLevel` to `none` for every
 *    `baselineAtCreate: true` resource, so on `signature` / `snippet` /
 *    `personal_inbox` — which have **zero** `role:org_member` rows in existence —
 *    "Inherit" and "Restricted" were one state under two labels.
 * 2. **The instance ladder is UNTOUCHED** (§8 item 23, §5.4). §3.1 dropped the
 *    *area* `Edit` rung for the private three; `ResourcePermission.edit` is still
 *    a real per-instance tier asserted by `assertEditInstance`, so this picker
 *    must keep offering `Read and write` on exactly those resources. The coupling
 *    is easy to "clean up" — filtering `POSITIVE_LEVELS` by the area's rungs looks
 *    like the obvious follow-up and would silently delete a live tier.
 */

// The body only mounts on expand, but its module reaches tRPC at import time.
vi.mock('./instance-share-body', () => ({
  InstanceShareBody: () => <div data-testid='share-body' />,
}))
// Only the `PRIVATE_INHERIT_*` constants are wanted from the hook module; the
// rest of it reaches tRPC at import time.
vi.mock('~/trpc/react', () => ({ api: {} }))

import {
  PRIVATE_INHERIT_HELPER,
  PRIVATE_INHERIT_KEYS,
  PRIVATE_INHERIT_LABEL,
} from '../hooks/use-instance-baseline-rows'
import { InstanceBaselineRows } from './instance-baseline-rows'

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

/** A `signature` row exactly as the hook composes it under §5.3. */
const SIGNATURE_ROW: InstanceBaselineRow = {
  key: 'signature',
  id: 'sig_1',
  name: 'Anna – Support',
  baselineLevel: undefined,
  inheritedLevel: undefined,
  inheritLabelText: 'Private',
  inheritHelperText: 'Only people granted below',
  badge: undefined,
}

/** A `dashboard` row — `baselineAtCreate: true` too, but NOT renamed. */
const DASHBOARD_ROW: InstanceBaselineRow = {
  key: 'dashboard',
  id: 'dash_1',
  name: 'Revenue',
  baselineLevel: undefined,
  inheritedLevel: ResourcePermission.view,
  badge: undefined,
}

function renderRows(rows: InstanceBaselineRow[], leadingRow?: React.ReactNode) {
  return render(
    <TooltipProvider>
      <InstanceBaselineRows rows={rows} leadingRow={leadingRow} onChange={vi.fn()} />
    </TooltipProvider>
  )
}

function triggerFor(name: string): HTMLElement {
  return within(
    screen.getByText(name).closest('div[class*="group/tree-row"]') as HTMLElement
  ).getAllByRole('combobox')[0] as HTMLElement
}

describe('plan 43 §5.3 — Inherit becomes Private where it resolves to nothing', () => {
  it('reads a bare "Private" on a signature, with no · No access suffix', () => {
    renderRows([SIGNATURE_ROW])

    expect(triggerFor('Anna – Support').textContent).toBe('Private')
  })

  it('replaces the inherit helper, because nothing is inherited', async () => {
    const user = userEvent.setup()
    renderRows([SIGNATURE_ROW])

    await user.click(triggerFor('Anna – Support'))
    const panel = await screen.findByRole('listbox')
    expect(panel.textContent).toContain('Only people granted below')
    expect(panel.textContent).not.toContain('What they get by default')
  })

  it('leaves dashboards on Inherit — 89 real baseline rows, so it resolves to something', () => {
    renderRows([DASHBOARD_ROW])

    expect(triggerFor('Revenue').textContent).toBe('Inherit · Read only')
  })
})

describe('plan 43 §5.3 — which resources are renamed is a census result, not a hunch', () => {
  it('renames exactly the three with no role:org_member row in existence', () => {
    expect([...PRIVATE_INHERIT_KEYS].sort()).toEqual(['personal_inbox', 'signature', 'snippet'])
    expect(PRIVATE_INHERIT_LABEL).toBe('Private')
    expect(PRIVATE_INHERIT_HELPER).toBe('Only people granted below')
  })

  it('renames only resources born with no baseline', () => {
    // The rename rests on `inheritedLevel` being a CONSTANT `none`, which is only
    // true for `baselineAtCreate: true`. Admitting an org-shared resource here
    // would label a real, resolvable fall-through "Private".
    for (const key of PRIVATE_INHERIT_KEYS) {
      expect(INSTANCE_ACCESS_RESOURCES[key].baselineAtCreate).toBe(true)
    }
  })

  it('leaves dashboard out, though it shares baselineAtCreate', () => {
    // 89 real `role:org_member @ view` rows — its Inherit resolves to something.
    expect(INSTANCE_ACCESS_RESOURCES.dashboard.baselineAtCreate).toBe(true)
    expect(PRIVATE_INHERIT_KEYS.has('dashboard')).toBe(false)
  })
})

describe('plan 43 §8 item 23 — the instance ladder keeps Read+write', () => {
  it('still offers Read and write on a signature, whose AREA lost its Edit rung', async () => {
    const user = userEvent.setup()
    renderRows([SIGNATURE_ROW])

    await user.click(triggerFor('Anna – Support'))
    const options = (await screen.findAllByRole('option')).map((o) =>
      o.querySelector('div.items-start > span')?.textContent?.trim()
    )
    // Private + the four per-instance tiers. `Read and write` is the one §3.1
    // could plausibly have taken with it and must not have.
    expect(options).toEqual(['Private', 'No access', 'Read only', 'Read and write', 'Full access'])
  })
})

describe('plan 43 §5.2 — the leading access row survives every branch', () => {
  it('renders above the list', () => {
    renderRows([SIGNATURE_ROW], <div data-testid='access-row' />)

    expect(screen.getByTestId('access-row')).toBeInTheDocument()
  })

  it('renders while the list is still loading', () => {
    render(
      <TooltipProvider>
        <InstanceBaselineRows
          rows={[]}
          isLoading
          leadingRow={<div data-testid='access-row' />}
          onChange={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(screen.getByTestId('access-row')).toBeInTheDocument()
  })

  it('renders when the list is empty — the case it is needed most', () => {
    // An `Inherit · <rung>` label with nothing on screen to inherit FROM is the
    // exact defect §0.7 exists to fix, and an empty collection is where it bites.
    renderRows([], <div data-testid='access-row' />)

    expect(screen.getByTestId('access-row')).toBeInTheDocument()
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })
})
