// apps/extension/src/iframe/routes/company-route.tsx

import { Button } from '@auxx/ui/components/button'
import { ParsedFields } from '../components/parsed-fields'
import { BASE_URL } from '../trpc'
import type { Route } from './types'

type Props = Extract<Route, { kind: 'company' }>

export function CompanyRoute({ company, existingRecordId }: Props) {
  return (
    <div className='space-y-4'>
      <ParsedFields company={company} />
      {existingRecordId ? (
        <Button asChild variant='outline' className='w-full'>
          <a
            href={`${BASE_URL}/app/companies/${existingRecordId}`}
            target='_blank'
            rel='noreferrer'>
            Open in Auxx
          </a>
        </Button>
      ) : null}
    </div>
  )
}
