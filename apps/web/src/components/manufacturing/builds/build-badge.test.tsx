// apps/web/src/components/manufacturing/builds/build-badge.test.tsx

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ granted: new Set<string>(), open: vi.fn() }))

vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ can: (key: string) => h.granted.has(key) }),
}))
vi.mock('./build-sheet-store', () => ({ openBuildSheet: h.open }))

import { BuildBadge } from './build-badge'

beforeEach(() => {
  h.granted = new Set()
  h.open.mockClear()
})

describe('BuildBadge', () => {
  it('opens the build sheet for a member with mrp.view', () => {
    h.granted.add('mrp.view')
    render(<BuildBadge build={{ buildId: 'b1', number: 'B-0001' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open build B-0001' }))
    expect(h.open).toHaveBeenCalledWith('b1')
  })

  it('is plain text without mrp.view', () => {
    render(<BuildBadge build={{ buildId: 'b1', number: 'B-0001' }} />)
    expect(screen.queryByRole('button')).toBeNull()
    fireEvent.click(screen.getByText('B-0001'))
    expect(h.open).not.toHaveBeenCalled()
  })
})
