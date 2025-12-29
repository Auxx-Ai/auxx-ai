import { Button } from '@react-email/components'
import { cn } from '../lib/utils'

import React from 'react'

interface EmailButtonProps {
  label: string
  href: string
  className?: string
}

export function EmailButton({ label, href, className }: EmailButtonProps): React.JSX.Element {
  return (
    <Button className={cn('rounded-md bg-black px-6 py-3 text-white', className)} href={href}>
      {label}
    </Button>
  )
}

export default EmailButton
