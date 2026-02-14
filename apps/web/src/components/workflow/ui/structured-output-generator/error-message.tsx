// apps/web/src/components/workflow/ui/structured-output-generator/error-message.tsx

import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle } from 'lucide-react'
import type { FC } from 'react'
import React from 'react'

type ErrorMessageProps = {
  message: string
} & React.HTMLAttributes<HTMLDivElement>

const ErrorMessage: FC<ErrorMessageProps> = ({ message, className }) => {
  return (
    <div className={cn('flex gap-x-1 mt-1 p-2 rounded-lg border-[0.5px]', className)}>
      <AlertTriangle className='size-4 shrink-0 text-bad-500' />
      <div className='system-xs-medium max-h-12 grow overflow-y-auto break-words'>{message}</div>
    </div>
  )
}

export default React.memo(ErrorMessage)
