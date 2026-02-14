// apps/web/src/app/(public)/workflows/run/[shareToken]/not-found.tsx

import { Button } from '@auxx/ui/components/button'
import Link from 'next/link'

/**
 * Not found page for invalid share tokens
 */
export default function PublicWorkflowRunNotFound() {
  return (
    <div className='flex h-screen flex-col items-center justify-center gap-4'>
      <h1 className='text-2xl font-bold'>Workflow Not Found</h1>
      <p className='text-muted-foreground'>
        This workflow doesn&apos;t exist or sharing has been disabled.
      </p>
      <Button asChild variant='outline'>
        <Link href='/'>Go Home</Link>
      </Button>
    </div>
  )
}
