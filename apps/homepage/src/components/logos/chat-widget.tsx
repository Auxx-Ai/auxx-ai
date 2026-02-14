// apps/web/src/components/logos/chat-widget.tsx
import type * as React from 'react'

const ChatWidget = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width={24}
    height={24}
    viewBox='0 0 24 24'
    fill='none'
    {...props}>
    <path
      d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z'
      fill='#10B981'
    />
    <circle cx='8' cy='10' r='1.5' fill='white' />
    <circle cx='12' cy='10' r='1.5' fill='white' />
    <circle cx='16' cy='10' r='1.5' fill='white' />
  </svg>
)

export default ChatWidget
