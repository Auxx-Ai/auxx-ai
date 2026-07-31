// apps/web/src/components/pickers/entity-breadcrumb-switcher.test.tsx
//
// The wiring test: `nav` on the switcher has to survive all the way to a real
// keypress. Everything below the surface is covered by the two hook tests — what
// is pinned here is that the buttons mount in the breadcrumb, that `J`/`K` reach
// them, and that `hotkeys: false` really unbinds rather than merely hiding.

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { fireEvent, render, screen } from '@testing-library/react'
import type * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))

import { useFavoritesStore } from '~/components/favorites/store/favorites-store'
import { EntityBreadcrumbSwitcher } from './entity-breadcrumb-switcher'
import type { EntitySwitcherItem } from './entity-switcher-list'

const ITEMS: EntitySwitcherItem[] = [
  { id: 'a', label: 'Alpha', href: '/app/agents/alpha' },
  { id: 'b', label: 'Bravo', href: '/app/agents/bravo' },
  { id: 'c', label: 'Charlie', href: '/app/agents/charlie' },
]

function renderSwitcher(
  props: Partial<React.ComponentProps<typeof EntityBreadcrumbSwitcher>> = {}
) {
  const onSelect = vi.fn()
  render(
    <HotkeysProvider>
      <TooltipProvider>
        <EntityBreadcrumbSwitcher
          activeLabel='Bravo'
          items={ITEMS}
          activeId='b'
          onSelect={onSelect}
          nav
          {...props}
        />
      </TooltipProvider>
    </HotkeysProvider>
  )
  return { onSelect }
}

describe('EntityBreadcrumbSwitcher — nav', () => {
  beforeEach(() => {
    useFavoritesStore.setState({ byId: {} })
  })

  it('mounts the arrows beside the crumb when `nav` is set', () => {
    renderSwitcher()

    expect(screen.getByLabelText('Previous')).toBeInTheDocument()
    expect(screen.getByLabelText('Next')).toBeInTheDocument()
  })

  it('mounts no arrows without `nav`', () => {
    renderSwitcher({ nav: undefined })

    expect(screen.queryByLabelText('Next')).not.toBeInTheDocument()
  })

  it('walks the list on J and K', () => {
    const { onSelect } = renderSwitcher()

    fireEvent.keyDown(document.body, { key: 'j', code: 'KeyJ' })
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2])

    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK' })
    expect(onSelect).toHaveBeenLastCalledWith(ITEMS[0])
  })

  it('walks the list on a button click', () => {
    const { onSelect } = renderSwitcher()

    fireEvent.click(screen.getByLabelText('Next'))
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2])
  })

  it('binds nothing when hotkeys are off, but keeps the buttons', () => {
    const { onSelect } = renderSwitcher({ nav: { hotkeys: false } })

    fireEvent.keyDown(document.body, { key: 'j', code: 'KeyJ' })
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Next'))
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2])
  })

  it('disables the ends rather than wrapping', () => {
    renderSwitcher({ activeId: 'a' })

    expect(screen.getByLabelText('Previous')).toBeDisabled()
    expect(screen.getByLabelText('Next')).toBeEnabled()
  })

  it('explains itself when the open entity is not in the list', async () => {
    renderSwitcher({ activeId: 'gone', nav: { orphanLabel: 'Agents' } })

    expect(screen.getByLabelText('Previous')).toBeDisabled()
    expect(screen.getByLabelText('Next')).toBeDisabled()
  })
})
