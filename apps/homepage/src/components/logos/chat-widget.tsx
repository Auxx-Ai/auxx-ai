// apps/homepage/src/components/logos/chat-widget.tsx
import type * as React from 'react'

const ChatWidget = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width={24}
    height={24}
    viewBox='0 0 24 24'
    fill='none'
    {...props}>
    <rect x='1' y='3' width='22' height='16' rx='4' fill='url(#chat-grad)' />
    <path d='M6 19l3.5 3v-3H6z' fill='url(#chat-grad)' />
    <circle cx='8' cy='11' r='1.25' fill='white' />
    <circle cx='12' cy='11' r='1.25' fill='white' />
    <circle cx='16' cy='11' r='1.25' fill='white' />
    <defs>
      <linearGradient id='chat-grad' x1='1' y1='3' x2='23' y2='22'>
        <stop stopColor='#6366f1' />
        <stop offset='1' stopColor='#8b5cf6' />
      </linearGradient>
    </defs>
  </svg>
)

export default ChatWidget
