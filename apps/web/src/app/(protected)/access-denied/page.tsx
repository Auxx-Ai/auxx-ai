// apps/web/src/app/(protected)/access-denied/page.tsx

import { Button } from '@auxx/ui/components/button'
import { Lock } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '~/components/global/empty-state'

export default function AccessDeniedPage() {
  return (
    <div className='flex h-screen w-full'>
      <EmptyState
        icon={Lock}
        title="You don't have access to this page"
        description='This area is limited to organization admins. Ask an admin if you think you should have access.'
        button={
          <Button asChild variant='outline'>
            <Link href='/app/settings'>Back to settings</Link>
          </Button>
        }
      />
    </div>
  )
}
