// apps/web/src/components/kopilot/hooks/use-prompt-templates.ts

'use client'

import { api } from '~/trpc/react'

/** Watch org-specific prompt templates (user-created + installed) */
export function usePromptTemplates() {
  const { data, isLoading } = api.promptTemplate.list.useQuery()
  return { templates: data ?? [], isLoading }
}

/** Get a single prompt template by ID from the cached list */
export function usePromptTemplate(id: string | null) {
  const { templates } = usePromptTemplates()
  return templates.find((t) => t.id === id) ?? null
}

/** Watch system templates for the gallery/browse dialog */
export function useSystemTemplates() {
  const { data, isLoading } = api.promptTemplate.listSystem.useQuery()
  return { templates: data ?? [], isLoading }
}
