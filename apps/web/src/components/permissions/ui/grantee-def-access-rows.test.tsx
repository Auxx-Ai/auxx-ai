// apps/web/src/components/permissions/ui/grantee-def-access-rows.test.tsx

import { ResourcePermission } from '@auxx/database/enums'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { type DefAccessRow, GranteeDefAccessRows } from './grantee-def-access-rows'

/**
 * Plan 33 phase 1 — the def child rows become the ONE renderer, so the props the
 * agent editor needs (phase 2) have to work before its own rows are deleted.
 *
 * Three of these are contracts a refactor breaks silently:
 *  - `leadingRow` sits OUTSIDE the loading and empty branches. That is behaviour,
 *    not layout: the agent's *"All record types"* row is what makes a sibling
 *    reading *"Default · No access"* legible, so it is needed most exactly when
 *    the list has nothing in it.
 *  - `includeNone` is off by default. A human per-def grant composes max-wins
 *    with `'none'` skipped, so offering No access there would author a row
 *    nothing reads (plan 33 §7.2 / D4).
 *  - orphan rows render their own copy, since the host only knows WHICH ids are
 *    orphaned, not what to say about them.
 */

// Radix's Select drives itself off pointer capture, which jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

const TICKETS: DefAccessRow = {
  id: 'edef_ticket',
  icon: { iconId: 'ticket', color: 'blue' },
  title: 'Tickets',
  grantLevel: ResourcePermission.edit,
  inheritedLevel: ResourcePermission.view,
}

const ORPHAN: DefAccessRow = {
  id: 'gone_away',
  icon: null,
  title: 'gone_away',
  grantLevel: ResourcePermission.admin,
  inheritedLevel: ResourcePermission.none,
  inheritLabelText: 'Default',
  isOrphan: true,
}

const LEADING = <div data-testid='leading'>All record types</div>

function renderRows(props: Partial<Parameters<typeof GranteeDefAccessRows>[0]> = {}) {
  return render(
    <TooltipProvider>
      <GranteeDefAccessRows rows={[TICKETS]} canEdit onChange={vi.fn()} {...props} />
    </TooltipProvider>
  )
}

/** Titles of the rendered `TreeRow` lines, in document order. */
function rowTitles(): string[] {
  return Array.from(document.querySelectorAll('span.truncate.px-1.text-foreground')).map(
    (el) => el.textContent?.trim() ?? ''
  )
}

describe('the leading row is structural, not part of the list', () => {
  it('renders it above the rows', () => {
    renderRows({ leadingRow: LEADING })

    const leading = screen.getByTestId('leading')
    const ticket = screen.getByText('Tickets')
    // `DOCUMENT_POSITION_FOLLOWING` — the row comes AFTER the leading row.
    expect(leading.compareDocumentPosition(ticket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps it on screen while the list is loading', () => {
    renderRows({ rows: [], isLoading: true, leadingRow: LEADING })

    expect(screen.getByTestId('leading')).toBeInTheDocument()
    expect(rowTitles()).toEqual([])
  })

  it('keeps it on screen when the list is empty', () => {
    renderRows({ rows: [], leadingRow: LEADING })

    expect(screen.getByTestId('leading')).toBeInTheDocument()
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('says what the HOST says when the list is empty', () => {
    renderRows({
      rows: [],
      emptyState: { icon: null, title: 'No record types', description: 'Nothing to rule on yet.' },
    })

    expect(screen.getByText('No record types')).toBeInTheDocument()
    expect(screen.queryByText('No matches')).toBeNull()
  })
})

describe('includeNone is the human/agent discriminant', () => {
  it('offers no deny option by default', async () => {
    const user = userEvent.setup()
    renderRows()

    await user.click(screen.getByRole('combobox'))
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '')

    // Inherit + the three positive rungs. A per-def `none` for one grantee is not
    // expressible by the composer, so the option must not exist here.
    expect(options).toHaveLength(4)
    expect(options.some((text) => text.startsWith('No access'))).toBe(false)
  })

  it('offers it when the surface authors a SET', async () => {
    const user = userEvent.setup()
    renderRows({ includeNone: true })

    await user.click(screen.getByRole('combobox'))
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '')

    expect(options).toHaveLength(5)
    expect(options.some((text) => text.startsWith('No access'))).toBe(true)
  })
})

describe('an orphan row carries its own copy', () => {
  it('renders muted, with the Unknown type note, and stays clearable', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    renderRows({ rows: [ORPHAN], includeNone: true, onChange })

    const title = screen.getByText('gone_away')
    expect(title.className).toContain('text-muted-foreground')
    expect(screen.getByText('Unknown type')).toBeInTheDocument()

    // Clearable is the point of rendering it at all: nothing else on screen can
    // reach a rule whose target is gone.
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /^Default/ }))
    expect(onChange).toHaveBeenCalledWith('gone_away', 'inherit')
  })
})

describe('a rule of its own is badged', () => {
  it('marks the row that carries one and leaves an inheriting row bare', () => {
    renderRows({
      rows: [TICKETS, { ...TICKETS, id: 'edef_contact', title: 'Contacts', grantLevel: undefined }],
    })

    const rows = Array.from(document.querySelectorAll<HTMLElement>('div[class*="group/tree-row"]'))
    const ticket = rows.find((r) => within(r).queryByText('Tickets'))
    const contact = rows.find((r) => within(r).queryByText('Contacts'))

    expect(within(ticket as HTMLElement).getByText('Override')).toBeInTheDocument()
    expect(within(contact as HTMLElement).queryByText('Override')).toBeNull()
  })
})
