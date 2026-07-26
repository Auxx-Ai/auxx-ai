// apps/web/src/components/permissions/hooks/use-agent-policy-resources.ts
'use client'

import type { InstanceAccessKey } from '@auxx/lib/permissions/client'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

/**
 * Instance lists for the Resources grid — one query per shareable resource type
 * (`dataset` / `kb` / `dashboard`), each fetched only while its type row is
 * expanded.
 *
 * Lazy on purpose: the policy itself is sparse, so an admin who only sets type
 * defaults never pays for three list queries. The lists are needed for the
 * *names* of instance overrides, not for the policy's correctness — an override
 * whose instance no longer exists is simply never looked up.
 */

/** How many instances one type row lists before it says "showing the first N". */
const INSTANCE_PAGE_SIZE = 100

/** One selectable resource instance. */
export interface PolicyResourceInstance {
  id: string
  name: string
}

/** One resource type's loaded instances. */
export interface PolicyResourceList {
  items: PolicyResourceInstance[]
  isLoading: boolean
  /** More instances exist than were fetched — the grid says so rather than lying. */
  truncated: boolean
}

/** Which type rows are currently expanded (and therefore worth querying). */
export type OpenResourceTypes = Partial<Record<InstanceAccessKey, boolean>>

/**
 * Fetch the instances of every expanded resource type.
 *
 * @param open - Expanded state per type; a collapsed type issues no query.
 */
export function useAgentPolicyResourceInstances(
  open: OpenResourceTypes
): Record<InstanceAccessKey, PolicyResourceList> {
  const datasets = api.dataset.list.useQuery(
    { limit: INSTANCE_PAGE_SIZE },
    { enabled: open.dataset === true, staleTime: 60_000 }
  )
  const kbs = api.kb.list.useQuery(undefined, { enabled: open.kb === true, staleTime: 60_000 })
  const dashboards = api.dashboard.list.useQuery(undefined, {
    enabled: open.dashboard === true,
    staleTime: 60_000,
  })

  return useMemo(
    () => ({
      dataset: {
        items: (datasets.data?.datasets ?? []).map((d) => ({ id: d.id, name: d.name })),
        isLoading: datasets.isLoading && open.dataset === true,
        truncated: datasets.data?.hasMore === true,
      },
      kb: {
        items: (kbs.data ?? []).map((k) => ({ id: k.id, name: k.name })),
        isLoading: kbs.isLoading && open.kb === true,
        truncated: false,
      },
      dashboard: {
        items: (dashboards.data ?? []).map((d: { id: string; name: string }) => ({
          id: d.id,
          name: d.name,
        })),
        isLoading: dashboards.isLoading && open.dashboard === true,
        truncated: false,
      },
    }),
    [
      datasets.data,
      datasets.isLoading,
      kbs.data,
      kbs.isLoading,
      dashboards.data,
      dashboards.isLoading,
      open,
    ]
  )
}
