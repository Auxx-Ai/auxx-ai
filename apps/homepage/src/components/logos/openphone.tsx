// apps/web/src/components/logos/openphone.tsx
import type * as React from 'react'

const OpenPhone = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width={24}
    height={24}
    viewBox='0 0 24 24'
    fill='none'
    {...props}>
    <path
      d='M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6.5 18.5c-.5.5-1.5.5-2 0l-2-2c-.5-.5-.5-1.5 0-2l1-1c.3-.3.3-.7 0-1l-3-3c-.3-.3-.7-.3-1 0l-1 1c-.5.5-1.5.5-2 0l-2-2c-.5-.5-.5-1.5 0-2l1-1c.8-.8 2.2-.8 3 0l8 8c.8.8.8 2.2 0 3l-1 1z'
      fill='#4285F4'
    />
    <circle cx='12' cy='12' r='3' fill='white' />
    <path d='M12 10.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z' fill='#4285F4' />
  </svg>
)

export default OpenPhone
