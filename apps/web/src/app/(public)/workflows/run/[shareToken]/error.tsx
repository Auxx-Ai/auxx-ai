// apps/web/src/app/(public)/workflows/run/[shareToken]/error.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { useEffect } from 'react'

/**
 * Props for error page
 */
interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Error boundary for workflow run page
 */
export default function PublicWorkflowRunError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className='flex h-screen flex-col items-center justify-center gap-4'>
      <h1 className='text-2xl font-bold'>Something went wrong</h1>
      <p className='text-muted-foreground'>We encountered an error while loading this workflow.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
