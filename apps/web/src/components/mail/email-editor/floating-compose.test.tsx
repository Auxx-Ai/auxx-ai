// apps/web/src/components/mail/email-editor/floating-compose.test.tsx
//
// Minimize is presentation, not teardown. The composer holds recipients, body,
// attachments and the Cc/Bcc disclosure in its own `useState` and mirrors none
// of it onto the store instance — so a minimize that swapped the editor out for
// the bar was a silent "clear the To field", and maximize had nothing to restore
// from (autosave refuses the first save until the body is non-empty, and the
// draft id it eventually learns never reaches the store).

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act, useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposeStore } from '../store/compose-store'

const h = vi.hoisted(() => ({
  mounts: 0,
  chatMounts: 0,
  provider: undefined as string | undefined,
}))

/**
 * Stands in for the whole composer. The uncontrolled input IS the thing under
 * test: local state that only survives if the component is never unmounted.
 */
vi.mock('./index', () => ({
  default: () => {
    const [value, setValue] = useState('')
    useEffect(() => {
      h.mounts++
    }, [])
    return (
      <input
        data-testid='recipients'
        aria-label='recipients'
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    )
  },
}))

/** Chat threads render this instead, docked or not — only `expanded` differs. */
vi.mock('../chat-panel', () => ({
  ChatPanel: ({ expanded }: { expanded: boolean }) => {
    useEffect(() => {
      h.chatMounts++
    }, [])
    return <div data-testid='chat' data-expanded={String(expanded)} />
  },
}))
vi.mock('~/components/channels/hooks/use-channels', () => ({
  useChannel: () => (h.provider ? { provider: h.provider } : undefined),
}))
vi.mock('./hooks/use-draft', () => ({ useDraft: () => ({ draft: null, isLoading: false }) }))

const { FloatingCompose } = await import('./floating-compose')

/** The store-driven render loop, same shape as `FloatingComposeRoot`. */
function Harness() {
  const instances = useComposeStore((s) => s.instances)
  return (
    <>
      {instances.map((instance) => (
        <FloatingCompose key={instance.id} instance={instance} />
      ))}
    </>
  )
}

beforeEach(() => {
  h.mounts = 0
  h.chatMounts = 0
  h.provider = undefined
  useComposeStore.setState({ instances: [], nextZIndex: 101 })
})

async function openFloatingCompose() {
  const id = useComposeStore.getState().open({ mode: 'new', displayMode: 'floating' })
  render(<Harness />)
  // Floating instances defer the editor mount by 200ms.
  await waitFor(() => expect(screen.getByLabelText('recipients')).toBeInTheDocument())
  return id
}

const TARGET_ID = 'reply-portal-t1'

/**
 * Open a docked composer the way `useCompose.openInline` does: the thread has
 * already committed its target div, THEN the instance is opened and docked. That
 * order is why the target lookup can be a plain render-time `getElementById`.
 */
function openInlineCompose() {
  render(
    <>
      <div id={TARGET_ID} />
      <Harness />
    </>
  )
  let id = ''
  act(() => {
    id = useComposeStore.getState().open({
      mode: 'reply',
      thread: { id: 't1' } as never,
      displayMode: 'inline',
    })
    useComposeStore.getState().dock(id, TARGET_ID)
  })
  return id
}

const target = () => document.getElementById(TARGET_ID) as HTMLElement
const composer = () => screen.getByLabelText('recipients')
/** The wrapper whose class carries the docked/floating presentation. */
const wrapper = () => composer().parentElement as HTMLElement

describe('FloatingCompose — minimize', () => {
  it('keeps the composer mounted, and its state, across minimize and maximize', async () => {
    const id = await openFloatingCompose()
    await userEvent.type(screen.getByLabelText('recipients'), 'jane@corp.com')

    act(() => useComposeStore.getState().minimize(id))
    expect(screen.getByText('New Message')).toBeInTheDocument()

    act(() => useComposeStore.getState().maximize(id))

    expect(screen.getByLabelText('recipients')).toHaveValue('jane@corp.com')
    // One mount for the whole round trip — a second would mean the editor was
    // torn down and re-derived from the store instance's stale props.
    expect(h.mounts).toBe(1)
  })

  it('hides the mounted composer behind the bar', async () => {
    const id = await openFloatingCompose()

    act(() => useComposeStore.getState().minimize(id))

    // Still in the tree, out of view: `display: none` takes it out of layout and
    // out of the tab order without touching its state.
    expect(wrapper()).toHaveClass('hidden')
  })

  it('closing from the bar tears it down', async () => {
    const id = await openFloatingCompose()
    act(() => useComposeStore.getState().minimize(id))

    await userEvent.click(screen.getByRole('button'))

    expect(useComposeStore.getState().instances).toEqual([])
    expect(screen.queryByLabelText('recipients')).not.toBeInTheDocument()
  })
})

// Pop-out and dock-back used to swap `createPortal(el, target)` for a
// `<motion.div>` — different element types at the same tree position, so React
// remounted the composer and cleared it exactly as minimize did. Now there is one
// portal host per instance and the DOM node is MOVED between parents, which React
// cannot see.
describe('FloatingCompose — pop-out and dock-back', () => {
  it('renders a docked composer inside the thread target', () => {
    openInlineCompose()

    expect(target().contains(composer())).toBe(true)
    // No fixed positioning while docked — it is a block in the thread's flow.
    expect(wrapper()).not.toHaveClass('fixed')
  })

  it('keeps the composer mounted, and its state, across pop-out and dock-back', async () => {
    const id = openInlineCompose()
    await userEvent.type(composer(), 'jane@corp.com')

    act(() => useComposeStore.getState().undock(id))

    expect(target().contains(composer())).toBe(false)
    // input → wrapper → host, and the host is parked on the body.
    expect(wrapper().parentElement?.parentElement).toBe(document.body)
    expect(wrapper()).toHaveClass('fixed')
    expect(composer()).toHaveValue('jane@corp.com')

    act(() => useComposeStore.getState().dock(id, TARGET_ID))

    expect(target().contains(composer())).toBe(true)
    expect(wrapper()).not.toHaveClass('fixed')
    expect(composer()).toHaveValue('jane@corp.com')
    // One mount across both moves. This is the whole point of the stable host.
    expect(h.mounts).toBe(1)
  })

  it('keeps the caret in the field the user was typing in', async () => {
    const id = openInlineCompose()
    await userEvent.type(composer(), 'jane@corp.com')
    expect(composer()).toHaveFocus()

    act(() => useComposeStore.getState().undock(id))

    // A DOM move is remove + insert, which blurs the active element — popping out
    // mid-address must not drop the user out of the field.
    expect(composer()).toHaveFocus()
    expect((composer() as HTMLInputElement).selectionStart).toBe('jane@corp.com'.length)
  })

  it('keeps a chat thread on ONE component across the move', () => {
    h.provider = 'chat'
    const id = openInlineCompose()

    expect(screen.getByTestId('chat')).toHaveAttribute('data-expanded', 'false')

    act(() => useComposeStore.getState().undock(id))

    // Same component, told to wear its chrome — not a swap to a different one,
    // which is what used to destroy the chat composer's editor.
    expect(screen.getByTestId('chat')).toHaveAttribute('data-expanded', 'true')
    expect(h.chatMounts).toBe(1)
  })

  it('takes its host with it when the instance closes', () => {
    const id = openInlineCompose()

    act(() => useComposeStore.getState().close(id))

    expect(target().childElementCount).toBe(0)
    expect(screen.queryByLabelText('recipients')).not.toBeInTheDocument()
  })
})
