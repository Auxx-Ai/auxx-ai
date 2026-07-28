// apps/web/src/components/permissions/hooks/use-instance-resource-lists.ts
'use client'

import type { InstanceAccessKey } from '@auxx/lib/permissions/client'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

/** How many instances one list fetches before it says "showing the first N". */
const INSTANCE_PAGE_SIZE = 100

/** One selectable resource instance. */
export interface InstanceResourceItem {
  id: string
  name: string
}

/** One resource type's loaded instances. */
export interface InstanceResourceList {
  items: InstanceResourceItem[]
  isLoading: boolean
  /** More instances exist than were fetched — the grid says so rather than lying. */
  truncated: boolean
}

/** Which resource types are currently worth querying. */
export type OpenInstanceTypes = Partial<Record<InstanceAccessKey, boolean>>

/**
 * Fetch the instances of every "open" instance-access resource type — one
 * query per shareable type (`api.dataset.list` / `api.kb.list` /
 * `api.dashboard.list` / `api.workflow.list`), each fetched only while its
 * caller marks it `open`.
 *
 * Generalized (capability layer v2 Part B.3) out of the agent-policy Resources
 * grid, which fetches lazily per manually-expanded type row (the policy is
 * sparse, so an admin who only sets type defaults never pays for three list
 * queries). The Datasets / Knowledge base / Dashboards area rows on the
 * Workspace defaults and grantee-override grids are the second caller: they pass
 * every key `open: true` unconditionally, because their host's search box has
 * to match against instance names to decide whether to auto-expand an area —
 * unlike the agent-policy grid, there is no search there to defer the fetch
 * behind.
 *
 * The lists are needed for the *names* of instances, not for correctness — an
 * override/grant whose instance no longer exists (or is outside the first
 * page) is simply rendered with its raw id and kept until cleared.
 */
export function useInstanceResourceLists(
  open: OpenInstanceTypes
): Record<InstanceAccessKey, InstanceResourceList> {
  const datasets = api.dataset.list.useQuery(
    { limit: INSTANCE_PAGE_SIZE },
    { enabled: open.dataset === true, staleTime: 60_000 }
  )
  const kbs = api.kb.list.useQuery(undefined, { enabled: open.kb === true, staleTime: 60_000 })
  const dashboards = api.dashboard.list.useQuery(undefined, {
    enabled: open.dashboard === true,
    staleTime: 60_000,
  })
  // Like the other three, `workflow.list` asserts nothing coarse and filters by
  // `canViewInstance` — the editor sees the workflows they may view, never a 403.
  const workflows = api.workflow.list.useQuery(
    { limit: INSTANCE_PAGE_SIZE, offset: 0 },
    { enabled: open.workflow === true, staleTime: 60_000 }
  )

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
      workflow: {
        items: (workflows.data?.workflows ?? []).map((w) => ({ id: w.id, name: w.name })),
        isLoading: workflows.isLoading && open.workflow === true,
        truncated: workflows.data?.hasMore === true,
      },
    }),
    [
      datasets.data,
      datasets.isLoading,
      kbs.data,
      kbs.isLoading,
      dashboards.data,
      dashboards.isLoading,
      workflows.data,
      workflows.isLoading,
      open,
    ]
  )
}
