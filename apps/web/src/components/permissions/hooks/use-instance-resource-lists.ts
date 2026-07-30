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
 * `api.dashboard.list` / `api.workflow.list` / `api.agent.list` /
 * `api.signature.list` / `api.snippet.all` / `api.record.listAll` for inboxes),
 * each fetched only while its caller marks it `open`. `personal_inbox` is the
 * one key with no query at all — see its entry below.
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
  // `agent.list` is unpaginated (the `kb.list` shape), so it can never truncate.
  const agents = api.agent.list.useQuery(undefined, {
    enabled: open.agent === true,
    staleTime: 60_000,
  })
  // `signature.list` asserts nothing coarse and filters by `canViewInstance`
  // (plan 36 §5), like the four above. It replaced a `record.listAll` call —
  // the generic record path now REFUSES instance-access defs outright (§3), so
  // this must not go back. Unpaginated, so it cannot truncate.
  const signatures = api.signature.list.useQuery(undefined, {
    enabled: open.signature === true,
    staleTime: 60_000,
  })
  // `snippet.all` is unpaginated, and `Snippet` names its display column
  // `title`, not `name`.
  const snippets = api.snippet.all.useQuery(
    { includeShared: true },
    { enabled: open.snippet === true, staleTime: 60_000 }
  )
  // Inboxes are the one instance-access resource with NO list router of its own
  // — `inbox.ts` has `myLenses` (ids + lenses, no names) and nothing else — so
  // this reads the generic record path, exactly as the mail sidebar
  // (`use-inbox.ts`) and the inbox picker already do. That is deliberate and NOT
  // a regression of the `signature` note above: the record path refuses instance-
  // access defs on its MUTATION arm only, and the mail keys are explicitly
  // exempted on its READ arm (`record.ts` `MAIL_READ_EXEMPT_KEYS`) because the
  // records capability layer was never an inbox's access authority —
  // `userInstanceGrants` is. Adding an `inbox.list` procedure would not have
  // closed anything either, since `record.getByIds` is an intentionally
  // MIXED-def batch and cannot move.
  // `fieldKeys` rather than the full fan-out: this list needs the NAME and
  // nothing else, and `listAll` otherwise loads every FieldValue for every row.
  const inboxes = api.record.listAll.useQuery(
    { entityDefinitionId: 'inbox', fieldKeys: ['inbox_name'] },
    { enabled: open.inbox === true, staleTime: 60_000 }
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
      agent: {
        // `Agent.name` is nullable (chat-driven creation leaves it unset and
        // writes `slug = id`), so fall back to the slug rather than rendering a
        // blank row.
        items: (agents.data ?? []).map((a) => ({ id: a.id, name: a.name ?? a.slug })),
        isLoading: agents.isLoading && open.agent === true,
        truncated: false,
      },
      signature: {
        items: (signatures.data ?? []).map((s) => ({ id: s.id, name: s.name })),
        isLoading: signatures.isLoading && open.signature === true,
        truncated: false,
      },
      snippet: {
        items: (snippets.data?.snippets ?? []).map((s) => ({ id: s.id, name: s.title })),
        isLoading: snippets.isLoading && open.snippet === true,
        truncated: false,
      },
      inbox: {
        // An inbox's real name is the `inbox_name` FieldValue;
        // `EntityInstance.displayName` is the entity system's denormalized copy
        // and is nullable, so it is the fallback rather than the source.
        items: (inboxes.data?.items ?? []).map((i) => ({
          id: i.id,
          name:
            (typeof i.fieldValues.inbox_name === 'string' ? i.fieldValues.inbox_name : null) ??
            i.displayName ??
            'Untitled inbox',
        })),
        isLoading: inboxes.isLoading && open.inbox === true,
        // `listAll` is unpaginated by contract ("small datasets like tags,
        // inboxes"), so it cannot truncate.
        truncated: false,
      },
      personal_inbox: {
        // DELIBERATELY EMPTY, and it is not an oversight of the #1361 kind.
        //
        // A personal inbox is one member's own mailbox. There is no workspace
        // default to set on it (`baselineAtCreate: true` ⇒ no row means no
        // access, whatever the area says), and enumerating every member's
        // mailbox into an admin grid would be the leak the two-key split exists
        // to prevent. `AREA_TO_INSTANCE_KEY` resolves `Area.inboxes` to `inbox`
        // for exactly this reason, so no area row ever asks for this list.
        //
        // It is also empty by necessity today: the `personal_inbox`
        // EntityDefinition does not exist yet (plan 40a's 059/060 seed it), so
        // there is nothing to query. If per-personal-inbox rows ever get a real
        // surface, they belong on the mailbox owner's own page, not here.
        items: [],
        isLoading: false,
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
      workflows.data,
      workflows.isLoading,
      agents.data,
      agents.isLoading,
      signatures.data,
      signatures.isLoading,
      snippets.data,
      snippets.isLoading,
      inboxes.data,
      inboxes.isLoading,
      open,
    ]
  )
}
