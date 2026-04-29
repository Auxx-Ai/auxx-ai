// packages/ui/src/components/kb/article/callout-icon.tsx

import type { CalloutVariant } from './types'

interface CalloutIconProps {
  variant: CalloutVariant
  size?: number
}

export function CalloutIcon({ variant, size = 18 }: CalloutIconProps) {
  switch (variant) {
    case 'tip':
      return (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width={size}
          height={size}
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
          aria-hidden='true'>
          <path d='M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5' />
          <path d='M9 18h6' />
          <path d='M10 22h4' />
        </svg>
      )
    case 'warn':
      return (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width={size}
          height={size}
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
          aria-hidden='true'>
          <path d='m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' />
          <path d='M12 9v4' />
          <path d='M12 17h.01' />
        </svg>
      )
    case 'error':
      return (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width={size}
          height={size}
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
          aria-hidden='true'>
          <circle cx='12' cy='12' r='10' />
          <path d='m15 9-6 6' />
          <path d='m9 9 6 6' />
        </svg>
      )
    case 'success':
      return (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width={size}
          height={size}
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
          aria-hidden='true'>
          <path d='M21.801 10A10 10 0 1 1 17 3.335' />
          <path d='m9 11 3 3L22 4' />
        </svg>
      )
    default:
      return (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width={size}
          height={size}
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
          aria-hidden='true'>
          <circle cx='12' cy='12' r='10' />
          <path d='M12 16v-4' />
          <path d='M12 8h.01' />
        </svg>
      )
  }
}
