// apps/extension/src/iframe/routes/contact-route.tsx

import { Button } from '@auxx/ui/components/button'
import { ParsedFields } from '../components/parsed-fields'
import { BASE_URL } from '../trpc'
import type { Route } from './types'

type Props = Extract<Route, { kind: 'contact' }>

/**
 * Read-only contact detail stub. Full in-iframe editing arrives in plan 18
 * (typed record.get/update + field renderer). For now: show the parsed
 * fields + a deep link if already saved.
 */
export function ContactRoute({ person, existingRecordId }: Props) {
  return (
    <div className='space-y-4'>
      <ParsedFields person={person} />
      {existingRecordId ? (
        <Button asChild variant='outline' className='w-full'>
          <a href={`${BASE_URL}/app/contacts/${existingRecordId}`} target='_blank' rel='noreferrer'>
            Open in Auxx
          </a>
        </Button>
      ) : null}
    </div>
  )
}
