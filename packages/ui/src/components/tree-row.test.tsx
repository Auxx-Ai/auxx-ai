// packages/ui/src/components/tree-row.test.tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeRow } from './tree-row'

// This package's vitest config has no `globals`, so RTL never registers its own
// auto-cleanup and every render would stack up in the same document.
afterEach(cleanup)

/**
 * The selection props are a shared-component addition, so half of this file is
 * the backward-compatibility half: a row that passes none of them must render
 * exactly what it rendered before.
 */
describe('TreeRow selection props', () => {
  it('renders no checkbox when none of the selection props are passed', () => {
    render(<TreeRow icon={<span data-testid='icon' />} title='Plain row' />)

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(document.querySelector('[data-slot=tree-row-select]')).toBeNull()
    // The icon keeps its resting classes — no hover fade added behind our back.
    const icon = screen.getByTestId('icon').parentElement
    expect(icon?.className).not.toContain('group-hover/tree-row:opacity-0')
  })

  it('leaves chevronOnHover alone when nothing is selectable', () => {
    render(<TreeRow icon={<span data-testid='icon' />} title='Row' expandable chevronOnHover />)

    // One expand control only: the leading hover chevron, no trailing twin.
    expect(screen.getAllByRole('button', { name: 'Expand' })).toHaveLength(1)
  })

  it('reveals the checkbox on hover when selectable', () => {
    render(<TreeRow icon={<span data-testid='icon' />} title='Row' selectable />)

    const wrapper = document.querySelector('[data-slot=tree-row-select]')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.className).toContain('opacity-0')
    expect(wrapper?.className).toContain('group-hover/tree-row:opacity-100')
    // ...and the icon cross-fades out under it.
    expect(screen.getByTestId('icon').parentElement?.className).toContain(
      'group-hover/tree-row:opacity-0'
    )
  })

  it('pins the checkbox and hides the icon while selecting', () => {
    render(<TreeRow icon={<span data-testid='icon' />} title='Row' selectable selecting />)

    const wrapper = document.querySelector('[data-slot=tree-row-select]')
    expect(wrapper?.className).not.toContain('opacity-0 group-hover')
    expect(wrapper?.className).not.toContain('group-hover/tree-row:opacity-100')
    expect(screen.getByTestId('icon').parentElement?.className).toContain('opacity-0')
  })

  it('shows the checkbox from `selecting` alone, without `selectable`', () => {
    render(<TreeRow title='Row' selecting />)

    expect(screen.getByRole('checkbox')).toBeTruthy()
  })

  it('renders the indeterminate state and selects the rest when clicked', () => {
    const onSelectChange = vi.fn()
    render(
      <TreeRow title='Group' selectable selected='indeterminate' onSelectChange={onSelectChange} />
    )

    const box = screen.getByRole('checkbox')
    expect(box.getAttribute('aria-checked')).toBe('mixed')

    box.click()
    // Partial → clicking completes the selection rather than clearing it.
    expect(onSelectChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it('deselects a fully selected row', () => {
    const onSelectChange = vi.fn()
    render(<TreeRow title='Row' selectable selected onSelectChange={onSelectChange} />)

    const box = screen.getByRole('checkbox')
    expect(box.getAttribute('aria-checked')).toBe('true')
    box.click()
    expect(onSelectChange).toHaveBeenCalledWith(false, expect.anything())
  })

  it('does not fire the row toggle when the checkbox is clicked', () => {
    const onToggleOpen = vi.fn()
    const onSelectChange = vi.fn()
    render(
      <TreeRow
        title='Row'
        expandable
        onToggleOpen={onToggleOpen}
        selectable
        onSelectChange={onSelectChange}
      />
    )

    screen.getByRole('checkbox').click()
    expect(onSelectChange).toHaveBeenCalledTimes(1)
    expect(onToggleOpen).not.toHaveBeenCalled()
  })

  it('keeps the checkbox itself focusable and clickable', () => {
    render(<TreeRow title='Row' selectable />)

    const box = screen.getByRole('checkbox')
    // The handler is on the control, not on a wrapper that swallows pointer
    // events, so a keyboard user can reach and toggle it.
    expect(box.className).not.toContain('pointer-events-none')
    expect(box.getAttribute('tabindex')).not.toBe('-1')
    box.focus()
    expect(document.activeElement).toBe(box)
  })

  it('labels the checkbox from a string title, and prefers an explicit selectLabel', () => {
    const { unmount } = render(<TreeRow title='Invoice 4471' selecting />)
    expect(screen.getByRole('checkbox').getAttribute('aria-label')).toBe('Invoice 4471')
    unmount()

    render(<TreeRow title={<em>rich</em>} selecting selectLabel='Select this share' />)
    expect(screen.getByRole('checkbox').getAttribute('aria-label')).toBe('Select this share')
  })

  it('keeps a trailing chevron when a checkbox pre-empts the chevronOnHover slot', () => {
    render(
      <TreeRow icon={<span data-testid='icon' />} title='Row' expandable chevronOnHover selecting />
    )

    // The checkbox owns the leading swap, so the row must not silently lose its
    // only expand affordance.
    expect(screen.getAllByRole('button', { name: 'Expand' })).toHaveLength(1)
    expect(screen.getByRole('checkbox')).toBeTruthy()
  })
})
