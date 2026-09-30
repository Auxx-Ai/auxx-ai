// apps/web/src/components/manufacturing/builds/build-sheet-fields.test.tsx

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type MutationOptions = {
  onSuccess: (saved: unknown, sent: { buildId: string; notes: string | null }) => void
  onSettled: () => void
}

const h = vi.hoisted(() => ({
  options: null as MutationOptions | null,
  mutate: vi.fn(),
  setData: vi.fn(),
}))

vi.mock('~/components/global/forms/field-panel', () => ({
  FieldPanelRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('~/components/workflow/types', () => ({ BaseType: { STRING: 'string', NUMBER: 'number' } }))
vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      builds: { get: { setData: h.setData }, list: { invalidate: vi.fn() } },
      mrp: { partItem: { invalidate: vi.fn() } },
    }),
    builds: {
      updateNotes: {
        useMutation: (options: MutationOptions) => {
          h.options = options
          return { mutate: h.mutate, error: null, isPending: false }
        },
      },
    },
  },
}))

import { BuildNotesRow } from './build-sheet-fields'

const build = (notes: string | null) => ({ buildId: 'b1', notes }) as never

const field = () => screen.getByLabelText('Build notes') as HTMLTextAreaElement

beforeEach(() => {
  h.mutate.mockReset()
  h.setData.mockReset()
})

describe('BuildNotesRow', () => {
  it('saves the full text once when blurred straight after typing', () => {
    render(<BuildNotesRow build={build(null)} canManage />)
    field().focus()
    fireEvent.change(field(), { target: { value: 'Cut four extra brackets' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(h.mutate).toHaveBeenCalledTimes(1)
    // A second blur while the save is in flight sends nothing.
    fireEvent.blur(field())

    expect(h.mutate).toHaveBeenCalledTimes(1)
    expect(h.mutate).toHaveBeenCalledWith({ buildId: 'b1', notes: 'Cut four extra brackets' })
  })

  it('writes the saved build into the cache instead of refetching, and keeps the text', () => {
    render(<BuildNotesRow build={build(null)} canManage />)
    fireEvent.change(field(), { target: { value: 'Rush' } })
    fireEvent.blur(field())
    act(() => {
      h.options?.onSuccess({ buildId: 'b1', notes: 'Rush' }, { buildId: 'b1', notes: 'Rush' })
      h.options?.onSettled()
    })

    expect(h.setData).toHaveBeenCalledWith({ buildId: 'b1' }, expect.any(Function))
    const update = h.setData.mock.calls[0]![1] as (prev: unknown) => unknown
    expect(update({ buildId: 'b1', notes: null, drifted: true })).toEqual({
      buildId: 'b1',
      notes: 'Rush',
      drifted: true,
    })
  })

  it('saves nothing when the value is unchanged', () => {
    render(<BuildNotesRow build={build('Rush')} canManage />)
    fireEvent.change(field(), { target: { value: 'Rush!' } })
    fireEvent.change(field(), { target: { value: 'Rush' } })
    fireEvent.blur(field())
    expect(h.mutate).not.toHaveBeenCalled()
  })

  it('stores emptied notes as null', () => {
    render(<BuildNotesRow build={build('Rush')} canManage />)
    fireEvent.change(field(), { target: { value: '   ' } })
    fireEvent.blur(field())
    expect(h.mutate).toHaveBeenCalledWith({ buildId: 'b1', notes: null })
  })

  it('is read-only text without mrp.manage', () => {
    render(<BuildNotesRow build={build('Rush')} canManage={false} />)
    expect(screen.queryByLabelText('Build notes')).toBeNull()
    expect(screen.getByText('Rush')).toBeTruthy()
  })
})
