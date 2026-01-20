// apps/web/src/components/fields/registries/dynamic-options-registry.ts

import { api } from '~/trpc/react'

/**
 * Option type returned by dynamic option loaders
 */
export interface DynamicOption {
  value: string
  label: string
  color?: string
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
  // Contact groups (for customerGroups field)
  contactGroups: {
    useOptions: (enabled) => {
      const { data, isLoading } = api.contact.getGroups.useQuery(
        {},
        { enabled, staleTime: 5 * 60 * 1000 }
      )
      return {
        data: data?.map((g) => ({ value: g.id, label: g.name, color: g.color ?? undefined })),
        isLoading,
      }
    },
  },

  // Team members (for assignee fields on ticket/thread)
  teamMembers: {
    useOptions: (enabled) => {
      const { data, isLoading } = api.user.teamMembers.useQuery(undefined, {
        enabled,
        staleTime: 5 * 60 * 1000,
      })
      return {
        data: data?.map((u) => ({ value: u.id, label: u.name ?? u.email })),
        isLoading,
      }
    },
  },

  // Contacts (for ticket contact field)
  contacts: {
    useOptions: (enabled) => {
      const { data, isLoading } = api.contact.getAll.useQuery(
        { limit: 100, page: 1 },
        { enabled, staleTime: 5 * 60 * 1000 }
      )
      return {
        data: data?.contacts?.map((c) => ({
          value: c.id,
          label: c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : c.email,
        })),
        isLoading,
      }
    },
  },

  // Integrations (for thread integration field)
  integrations: {
    useOptions: (enabled) => {
      const { data, isLoading } = api.integration.getIntegrations.useQuery(undefined, {
        enabled,
        staleTime: 5 * 60 * 1000,
      })

      return {
        data: data?.map((i) => ({ value: i.id, label: i.name ?? i.email })),
        isLoading,
      }
    },
  },

  // Inboxes (for thread inbox field)
  inboxes: {
    useOptions: (enabled) => {
      const { data, isLoading } = api.inbox.getAll.useQuery(undefined, {
        enabled,
        staleTime: 5 * 60 * 1000,
      })
      return {
        data: data?.map((i) => ({ value: i.id, label: i.name })),
        isLoading,
      }
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
        data: data?.map((t) => ({ value: t.id, label: t.title, color: t.color ?? undefined })),
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
