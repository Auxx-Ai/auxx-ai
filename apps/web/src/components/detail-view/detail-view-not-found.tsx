// apps/web/src/components/detail-view/detail-view-not-found.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { useRouter } from 'next/navigation'
import { GranularPermissionsGate } from '~/components/mail-permissions/ui/granular-permissions-gate'
import { RecordRequestAccessPopover } from '~/components/permissions/ui/record-request-access-popover'
import type { DetailViewNotFoundProps } from './types'

/**
 * DetailViewNotFound - not found state for detail view page.
 *
 * **Mount 4 of the record access-request lane** (plan v3/04 §8.2 / D2). This is
 * the only surface where the `none → read` ask has an honest home: everywhere
 * else a record renders, reaching it already proves `read`, so the ask there is
 * `read → edit`. Here the record is not in the store at all.
 *
 * 🔴 **Nothing on this screen may name the record.** §9 accepted a bounded
 * EXISTENCE oracle — a request that sends confirms the record exists in this
 * org, a refusal confirms it does not — and explicitly did not accept a CONTENT
 * leak. The popover's header is composed server-side and returns the definition
 * noun alone for a `none` requester (`buildRecordSubjectLabel`), so the rule here
 * is simply: do not read a display name from any store or prop. `label` is the
 * DEFINITION's label, which the breadcrumb already showed before this mount
 * existed.
 */
export function DetailViewNotFound({
  label,
  backUrl,
  entityDefinitionId,
  entityInstanceId,
}: DetailViewNotFoundProps) {
  const router = useRouter()

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title={label ?? 'Records'} href={backUrl} />
          <MainPageBreadcrumbItem title='Not Found' />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className='flex flex-col items-center justify-center h-full gap-4'>
          <h1 className='text-2xl font-bold'>Record Not Found</h1>
          <p className='text-muted-foreground text-center max-w-md'>
            {/* "…or you may not have permission to view it" used to close this
                sentence. The control below replaces it: an ambiguous hint the
                reader can do nothing with is worse than an ask that answers the
                question by whether it sends. */}
            The requested record could not be found. It may have been deleted
            {entityDefinitionId && entityInstanceId
              ? '.'
              : ', or you may not have permission to view it.'}
          </p>
          {entityDefinitionId && entityInstanceId && (
            <GranularPermissionsGate>
              <RecordRequestAccessPopover
                entityDefinitionId={entityDefinitionId}
                entityInstanceId={entityInstanceId}
                // The record is not in the store, so the unstamped fallback would
                // answer with the member's DEF rung — reporting `read` (or more)
                // for a record they demonstrably cannot reach, and wording the ask
                // as "Request edit access" (§8.3).
                assumeNoAccess
              />
            </GranularPermissionsGate>
          )}
          <Button onClick={() => router.push(backUrl)}>Return to List</Button>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
