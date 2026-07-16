import { Button } from '@react-email/components'
import React from 'react'

import { cn } from '../lib/utils'

void React
interface EmailButtonProps {
  label: string
  href: string
  className?: string
  /** Inline overrides (e.g. brand accent `backgroundColor`) — win over the default black bg. */
  style?: React.CSSProperties
}

export function EmailButton({
  label,
  href,
  className,
  style,
}: EmailButtonProps): React.JSX.Element {
  return (
    <Button
      className={cn('rounded-md bg-black px-6 py-3 text-white', className)}
      href={href}
      style={style}>
      {label}
    </Button>
  )
}

export default EmailButton
