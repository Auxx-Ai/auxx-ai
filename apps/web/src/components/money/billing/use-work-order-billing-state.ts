// apps/web/src/components/money/billing/use-work-order-billing-state.ts
'use client'

import type { RecordId } from '@auxx/types/resource'
import { useEffect, useMemo, useRef } from 'react'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { api } from '~/trpc/react'
import { normalizeWorkOrderBilling } from './types'

/** One composed, allocation-backed billing read shared by every work-order surface. */
export function useWorkOrderBillingState(workOrderRecordId: RecordId) {
  const utils = api.useUtils()
  const query = api.money.getWorkOrderBillingState.useQuery({ workOrderRecordId })
  const { values } = useSystemValues(workOrderRecordId, ['work_order_billing_revision'], {
    autoFetch: true,
  })
  const revision = values.work_order_billing_revision
  const previousRevision = useRef(revision)
  useEffect(() => {
    if (previousRevision.current === undefined) {
      previousRevision.current = revision
      return
    }
    if (revision !== previousRevision.current) {
      previousRevision.current = revision
      void utils.money.getWorkOrderBillingState.invalidate({ workOrderRecordId })
    }
  }, [revision, utils, workOrderRecordId])
  const billing = useMemo(() => normalizeWorkOrderBilling(query.data), [query.data])
  return { ...query, billing }
}
