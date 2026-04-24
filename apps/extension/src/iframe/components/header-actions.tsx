// apps/extension/src/iframe/components/header-actions.tsx

import { Button } from '@auxx/ui/components/button'
import { ExternalLink } from 'lucide-react'
import type { Route } from '../routes/types'
import { BASE_URL } from '../trpc'

type Props = {
  route: Route
}

/**
 * Right-hand slot in the detail-view header. Root has no actions (the Save
 * button lives at the bottom of the capture view there). Contact/company
 * detail routes surface a single deep-link to auxx.ai for the saved record.
 */
export function HeaderActions({ route }: Props) {
  if (route.kind === 'root') return null

  const href =
    route.kind === 'contact'
      ? `${BASE_URL}/app/contacts/${route.existingRecordId ?? ''}`
      : `${BASE_URL}/app/companies/${route.existingRecordId ?? ''}`

  if (!route.existingRecordId) return null

  return (
    <Button variant='ghost' size='sm' asChild>
      <a href={href} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1'>
        <ExternalLink className='size-3.5' />
        Open
      </a>
    </Button>
  )
}
