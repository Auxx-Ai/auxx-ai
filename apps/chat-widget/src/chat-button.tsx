// apps/chat-widget/src/chat-button.tsx

interface ChatButtonProps {
  primaryColor: string
  onClick: () => void
}

export function ChatButton({ primaryColor, onClick }: ChatButtonProps) {
  return (
    <button
      type='button'
      class='auxx-chat-button'
      style={{ backgroundColor: primaryColor }}
      onClick={onClick}
      aria-label='Open chat'>
      <svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
        <path d='M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2z' />
      </svg>
    </button>
  )
}
