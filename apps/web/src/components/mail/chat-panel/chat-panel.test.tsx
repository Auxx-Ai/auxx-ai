// apps/web/src/components/mail/chat-panel/chat-panel.test.tsx
//
// Docked and undocked are ONE component with conditional chrome, not two
// components. `FloatingCompose` used to choose between `<ChatPanel>` and a bare
// `<ChatComposer>` — different element types at the same tree position — so
// popping a chat out remounted the composer and destroyed its Tiptap editor
// along with whatever the agent had typed.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ mounts: 0 }))

/** Stands in for the composer: local state that only survives a re-render. */
vi.mock('../chat-composer', () => ({
  default: ({ hideHeader }: { hideHeader?: boolean }) => {
    const [value, setValue] = useState('')
    useEffect(() => {
      h.mounts++
    }, [])
    return (
      <div>
        {!hideHeader && <span>composer header</span>}
        <input aria-label='reply' value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
    )
  },
}))

vi.mock('./header', () => ({
  ChatPanelHeader: () => <div>panel header</div>,
}))
vi.mock('./messages', () => ({
  ChatPanelMessages: () => <div>message log</div>,
}))

const { ChatPanel } = await import('./index')

const thread = { id: 't1', integrationId: 'i1' } as never

function renderPanel(expanded: boolean) {
  return render(
    <ChatPanel thread={thread} expanded={expanded} onClose={vi.fn()} onSendSuccess={vi.fn()} />
  )
}

beforeEach(() => {
  h.mounts = 0
})

describe('ChatPanel', () => {
  it('docked, renders only the composer and its own header', () => {
    renderPanel(false)

    expect(screen.getByLabelText('reply')).toBeInTheDocument()
    expect(screen.getByText('composer header')).toBeInTheDocument()
    // The thread view behind it already shows these.
    expect(screen.queryByText('panel header')).not.toBeInTheDocument()
    expect(screen.queryByText('message log')).not.toBeInTheDocument()
  })

  it('undocked, wraps the composer in the panel chrome', () => {
    renderPanel(true)

    expect(screen.getByText('panel header')).toBeInTheDocument()
    expect(screen.getByText('message log')).toBeInTheDocument()
    // One header, not two — the panel's replaces the composer's.
    expect(screen.queryByText('composer header')).not.toBeInTheDocument()
  })

  it('keeps what the agent typed when the chrome appears and disappears', async () => {
    const { rerender } = renderPanel(false)
    await userEvent.type(screen.getByLabelText('reply'), 'on my way')

    rerender(
      <ChatPanel thread={thread} expanded={true} onClose={vi.fn()} onSendSuccess={vi.fn()} />
    )
    expect(screen.getByText('panel header')).toBeInTheDocument()
    expect(screen.getByLabelText('reply')).toHaveValue('on my way')

    rerender(
      <ChatPanel thread={thread} expanded={false} onClose={vi.fn()} onSendSuccess={vi.fn()} />
    )
    expect(screen.getByLabelText('reply')).toHaveValue('on my way')
    // One mount for the round trip. The conditional chrome holds its slots with
    // `false`, so the composer never shifts index and React never remounts it.
    expect(h.mounts).toBe(1)
  })
})
