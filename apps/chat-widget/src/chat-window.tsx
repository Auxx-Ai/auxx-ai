// apps/chat-widget/src/chat-window.tsx

import type { Ref } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ChatMessage } from './transport/chat-api'
import type { ChatConfig } from './transport/config'

interface ChatPanelProps {
  config: ChatConfig
  messages: ChatMessage[]
  sending: boolean
  error: string | null
  inputRef: Ref<HTMLInputElement>
  onClose: () => void
  onSend: (content: string) => void
}

export function ChatPanel({
  config,
  messages,
  sending,
  error,
  inputRef,
  onClose,
  onSend,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages.length])

  const submit = () => {
    const value = draft.trim()
    if (!value || sending) return
    onSend(value)
    setDraft('')
  }

  return (
    <>
      <div class='auxx-chat-header'>
        <div>
          <div class='auxx-chat-header__title'>{config.appearance.title}</div>
          {config.appearance.subtitle ? (
            <div class='auxx-chat-header__subtitle'>{config.appearance.subtitle}</div>
          ) : null}
        </div>
        <button
          type='button'
          class='auxx-chat-header__close'
          onClick={onClose}
          aria-label='Close chat'>
          ×
        </button>
      </div>
      <div ref={bodyRef} class='auxx-chat-body'>
        {messages.map((m) => (
          <div key={m.id} class={`auxx-chat-message auxx-chat-message--${m.sender.toLowerCase()}`}>
            {m.content}
          </div>
        ))}
      </div>
      {error ? <div class='auxx-chat-error'>{error}</div> : null}
      <form
        class='auxx-chat-footer'
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}>
        <input
          ref={inputRef}
          class='auxx-chat-input'
          placeholder='Type a message…'
          value={draft}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          disabled={sending}
        />
        <button
          type='submit'
          class='auxx-chat-send'
          disabled={sending || draft.trim().length === 0}>
          Send
        </button>
      </form>
    </>
  )
}
