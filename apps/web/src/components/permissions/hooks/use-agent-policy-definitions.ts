// apps/web/src/components/permissions/hooks/use-agent-policy-definitions.ts
'use client'

import { isAccessManageable, type Resource } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useResources } from '~/components/resources/hooks'

/**
 * The entity definitions an agent policy can carry a rule for, keyed the way the
 * policy is written: by **`apiSlug`**, not by CUID (plan 19 §3). A slug key means
 * an override survives archive/restore, and a definition created after publish
 * resolves through the collection default rather than through a dangling id.
 *
 * Mail/messaging-infrastructure defs and the instance-access resources
 * (`dataset`, `kb`, `dashboard`, `article`) are excluded by `isAccessManageable`.
 * That is not cosmetic: `AgentPolicyCapabilities.canViewEntity` short-circuits
 * `true` for mail-infra defs before the definitions keyspace is consulted, and
 * the three shareable resources are governed by the Resources grid instead — so a
 * row for any of them would be a control that writes a rule nothing reads
 * (plan 19 §11a, "the step 7 editor must not offer them").
 */
export interface AgentPolicyDefinition {
  /** The policy key. */
  apiSlug: string
  /** Canonical def id — what the client capability gates take. */
  entityDefinitionId: string
  /** Plural display name. */
  label: string
  /** Icon id + colour for the row's `EntityIcon`. */
  icon: string
  color: string
}

/** The org's rule-able definitions, alphabetical. */
export function useAgentPolicyDefinitions(): {
  definitions: AgentPolicyDefinition[]
  isLoading: boolean
} {
  const { resources, isLoading } = useResources()

  const definitions = useMemo(
    () =>
      resources
        .filter((resource: Resource) => isAccessManageable(resource))
        .map((resource) => ({
          apiSlug: resource.apiSlug,
          entityDefinitionId: resource.entityDefinitionId,
          label: resource.plural,
          icon: resource.icon,
          color: resource.color,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [resources]
  )

  return { definitions, isLoading }
}
