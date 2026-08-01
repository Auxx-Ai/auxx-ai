// apps/web/src/components/fields/registries/dynamic-options-registry.ts

import { SELECT_OPTION_COLORS, type SelectOptionColor } from '@auxx/types/custom-field'
import { useMemo } from 'react'
import { useAllRecords } from '~/components/resources/hooks/use-all-records'
import { api } from '~/trpc/react'

/**
 * Option type returned by dynamic option loaders
 */
export interface DynamicOption {
  value: string
  label: string
  /** Must be a `SelectOptionColor` — these options are merged into `FieldOptions.options`. */
  color?: SelectOptionColor
}

/** Narrow a stored color string to the select-option palette; unknown values drop out. */
function toOptionColor(color: string | null | undefined): SelectOptionColor | undefined {
  return SELECT_OPTION_COLORS.find((c) => c === color)
}

/**
 * Registry entry for a dynamic options source
 */
interface DynamicOptionsEntry {
  /** Hook to fetch options. Takes enabled flag for conditional fetching. */
  useOptions: (enabled: boolean) => {
    data: DynamicOption[] | undefined
    isLoading: boolean
  }
}

/**
 * Registry mapping dynamicOptionsKey to fetch logic.
 * Add new entries here when adding fields with dynamic options.
 *
 * MIGRATED FROM: use-dynamic-field-options.ts QUERY_REGISTRY
 */
export const DYNAMIC_OPTIONS_REGISTRY: Record<string, DynamicOptionsEntry> = {
  // TODO: contactGroups entry removed - CustomerGroup table deleted.
  // Groups are now managed via entity-group-member table.

  // Team members (for assignee fields on ticket/thread)
  teamMembers: {
    useOptions: (enabled) => {
      const { data, isLoading } = api.user.teamMembers.useQuery(undefined, {
        enabled,
        staleTime: 5 * 60 * 1000,
      })
      return {
        // `user.teamMembers` nulls out id/name/email for memberships whose User
        // row is missing. A `value: null` option is unselectable (and throws in
        // Radix Select), so drop those rows instead of listing them blank.
        data: data
          ?.filter((u): u is typeof u & { id: string } => u.id !== null)
          .map((u) => ({ value: u.id, label: u.name ?? u.email ?? 'Unknown' })),
        isLoading,
      }
    },
  },

  // Integrations (for thread integration field)
  integrations: {
    useOptions: (enabled) => {
      const { data, isLoading } = api.channel.list.useQuery(undefined, {
        enabled,
        staleTime: 5 * 60 * 1000,
      })

      return {
        data: data?.channels?.map((i) => ({ value: i.id, label: i.name ?? i.email })),
        isLoading,
      }
    },
  },

  // Inboxes (for thread inbox field) — backed by record.listAll so field-value
  // mutations (color / name edits) invalidate the dropdown automatically.
  //
  // Unions BOTH inbox definitions (plan 40 §3.4): a thread's inbox may live on
  // `personal_inbox` after data migration 060, and a one-def list would render
  // those threads' inbox field as an unresolvable id. The option VALUE stays
  // the bare instance id (no def prefix) — the write path decides the def.
  inboxes: {
    useOptions: (enabled) => {
      const shared = useAllRecords({ entityDefinitionId: 'inbox', enabled })
      const personal = useAllRecords({ entityDefinitionId: 'personal_inbox', enabled })
      const data = useMemo(
        () =>
          [...shared.records, ...personal.records].map((r) => ({
            value: r.id,
            label:
              (r.fieldValues as { inbox_name?: string } | undefined)?.inbox_name ??
              r.displayName ??
              'Untitled',
          })),
        [shared.records, personal.records]
      )
      return { data, isLoading: shared.isLoading || personal.isLoading }
    },
  },

  // Tags (for tag fields on all models)
  tags: {
    useOptions: (enabled) => {
      const { data, isLoading } = api.tag.getAll.useQuery(undefined, {
        enabled,
        staleTime: 5 * 60 * 1000,
      })
      return {
        data: data?.map((t) => ({
          value: t.id,
          label: t.title,
          color: toOptionColor(t.tag_color),
        })),
        isLoading,
      }
    },
  },
}

/**
 * Get dynamic options entry by key.
 * Returns undefined if key not found in registry.
 */
export function getDynamicOptionsEntry(key: string): DynamicOptionsEntry | undefined {
  return DYNAMIC_OPTIONS_REGISTRY[key]
}
