// apps/web/src/components/mail-filters/hooks/use-mail-filter-lookups.ts

'use client'

import type { MailFilterNameResolver } from '@auxx/lib/mail-filters/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { useMemo } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/** An inbox the caller may author filters on — `api.mailFilters.authorableInboxes` row. */
export interface AuthorableInboxOption {
  id: string
  name: string
  isPersonal: boolean
}

export interface MailFilterLookups {
  /** Thread-scoped tags, for the `add-tag` / `remove-tag` pickers. */
  tagOptions: SelectOption[]
  /** Published workflows, for `run-workflow`. Empty without the automation key. */
  workflowOptions: SelectOption[]
  /** Agents the caller may see, for `run-agent`. Empty without the automation key. */
  agentOptions: SelectOption[]
  /** Inboxes the caller may write to, for `move-inbox` and the inbox picker. */
  inboxOptions: SelectOption[]
  /**
   * id → display name for `describeMailFilter`, so cards read "Add tag Billing"
   * rather than "Add tag cm3x…". Covers tags, actors (members AND groups),
   * inboxes, agents and workflows in one flat map.
   */
  resolveName: MailFilterNameResolver
}

/**
 * Every id→label source the filter UI needs, resolved once.
 *
 * Agents and workflows are only fetched for an author holding
 * `automationRules.manage`: `run-agent` / `run-workflow` are excluded from that
 * author's catalog entirely (§5.1), so querying them would be two round trips
 * spent on options nobody can pick.
 */
export function useMailFilterLookups(inboxes: AuthorableInboxOption[]): MailFilterLookups {
  const { can } = useAccess()
  const canRunAutomation = can('automationRules.manage')

  const { data: tags } = api.tag.getAll.useQuery({ scope: 'thread' }, { staleTime: 60_000 })
  const { data: actors } = api.actor.list.useQuery({ target: 'both' }, { staleTime: 60_000 })
  const { data: workflowData } = api.workflow.list.useQuery(
    {},
    { staleTime: 60_000, enabled: canRunAutomation }
  )
  const { data: agents } = api.agent.list.useQuery(undefined, {
    staleTime: 60_000,
    enabled: canRunAutomation,
  })

  const tagOptions = useMemo<SelectOption[]>(
    () => (tags ?? []).map((tag) => ({ value: tag.id, label: tag.title })),
    [tags]
  )

  const workflowOptions = useMemo<SelectOption[]>(
    () =>
      (workflowData?.workflows ?? [])
        .filter((workflow: { enabled?: boolean }) => workflow.enabled)
        .map((workflow: { id: string; name: string }) => ({
          value: workflow.id,
          label: workflow.name,
        })),
    [workflowData]
  )

  const agentOptions = useMemo<SelectOption[]>(
    () =>
      (agents ?? []).map((agent) => ({ value: agent.id, label: agent.name ?? 'Untitled agent' })),
    [agents]
  )

  const inboxOptions = useMemo<SelectOption[]>(
    () => inboxes.map((inbox) => ({ value: inbox.id, label: inbox.name })),
    [inboxes]
  )

  const resolveName = useMemo<MailFilterNameResolver>(() => {
    const names = new Map<string, string>()
    for (const tag of tags ?? []) names.set(tag.id, tag.title)
    for (const actor of actors ?? []) {
      names.set(actor.actorId, actor.name)
      // `assign` may also store a bare user id (the executor accepts both), so
      // index the raw id as well or those summaries fall back to the cuid.
      const raw = actor.actorId.split(':')[1]
      if (raw) names.set(raw, actor.name)
    }
    for (const inbox of inboxes) names.set(inbox.id, inbox.name)
    for (const agent of agents ?? []) names.set(agent.id, agent.name ?? 'Untitled agent')
    for (const workflow of workflowData?.workflows ?? []) names.set(workflow.id, workflow.name)
    return (id: string) => names.get(id)
  }, [tags, actors, inboxes, agents, workflowData])

  return { tagOptions, workflowOptions, agentOptions, inboxOptions, resolveName }
}
