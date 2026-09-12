// apps/web/src/components/line-grid/__tests__/line-row-menu.test.tsx
//
// Pins the two behaviours money/tasks/56 §3.4 requires the `line-grid` kit's
// `LineRowMenu` shell to keep verbatim from money's original:
//
// 1. The trigger's `onMouseDown` calls `preventDefault()`, so opening the
//    menu never blurs (and collapses) a focused cell input - Radix opens on
//    pointerdown, which fires before mousedown, so the menu still opens.
// 2. The content's `onCloseAutoFocus` is prevented, so the mouse-only
//    (`tabIndex={-1}`) trigger never steals focus from an editor the menu
//    itself just opened (e.g. "Add description" autofocusing its textarea).

import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  lastOnCloseAutoFocus: undefined as ((e: Event) => void) | undefined,
}))

vi.mock('@auxx/ui/components/dropdown-menu', async () => {
  const actual = await vi.importActual<typeof import('@auxx/ui/components/dropdown-menu')>(
    '@auxx/ui/components/dropdown-menu'
  )
  return {
    ...actual,
    // Captures the prop money/tasks/56 §3.4 pins, then delegates to the real
    // Radix content - Radix itself still owns whether it actually mounts.
    DropdownMenuContent: (props: ComponentProps<typeof actual.DropdownMenuContent>) => {
      h.lastOnCloseAutoFocus = props.onCloseAutoFocus as ((e: Event) => void) | undefined
      return <actual.DropdownMenuContent {...props} />
    },
  }
})

import { LineRowMenu } from '../ui/line-row-menu'

function renderMenu(onDelete = vi.fn()) {
  return render(
    <TooltipProvider>
      <LineRowMenu onDelete={onDelete}>
        <DropdownMenuItem onSelect={() => {}}>Custom item</DropdownMenuItem>
      </LineRowMenu>
    </TooltipProvider>
  )
}

describe('LineRowMenu', () => {
  it('prevents default on the trigger mousedown', () => {
    renderMenu()
    const trigger = screen.getByRole('button')

    // `dispatchEvent` (what `fireEvent` calls) returns false when the event
    // is cancelable and `preventDefault()` was invoked during dispatch.
    const notPrevented = fireEvent.mouseDown(trigger)

    expect(notPrevented).toBe(false)
  })

  it('prevents onCloseAutoFocus on the content', () => {
    renderMenu()

    expect(h.lastOnCloseAutoFocus).toBeInstanceOf(Function)
    const fakeEvent = { preventDefault: vi.fn() } as unknown as Event
    h.lastOnCloseAutoFocus?.(fakeEvent)

    expect(fakeEvent.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('renders the caller items above a destructive delete item, and wires onDelete', async () => {
    const onDelete = vi.fn()
    renderMenu(onDelete)

    await userEvent.click(screen.getByRole('button'))
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Custom item')
    expect(items[1]).toHaveTextContent('Delete line')

    await userEvent.click(items[1])
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('accepts a custom deleteLabel', async () => {
    renderMenu()
    // Re-render with a custom label via a fresh instance.
    render(
      <TooltipProvider>
        <LineRowMenu onDelete={vi.fn()} deleteLabel='Delete this'>
          <DropdownMenuItem onSelect={() => {}}>Item</DropdownMenuItem>
        </LineRowMenu>
      </TooltipProvider>
    )
    const triggers = screen.getAllByRole('button')
    await userEvent.click(triggers[triggers.length - 1])
    expect(screen.getByRole('menuitem', { name: /Delete this/ })).toBeInTheDocument()
  })
})
