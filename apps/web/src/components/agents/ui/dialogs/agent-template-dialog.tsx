// apps/web/src/components/agents/ui/dialogs/agent-template-dialog.tsx
'use client'

import { constants } from '@auxx/config/client'
import { type AgentTemplate, agentTemplates } from '@auxx/lib/agents/client'
import { EntityIcon } from '@auxx/ui/components/icons'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { TemplateGalleryDialog } from '~/components/templates/ui'
import { useAgentMutations } from '../../hooks/use-agent-mutations'

interface AgentTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Scopes the dialog to one agent kind; templates are filtered to it. */
  kind: 'internal' | 'chat'
}

/**
 * "Create from template" dialog for the agents list page. List-only — clicking a
 * row creates a draft agent and routes to its detail page with `?template=<id>`;
 * `AgentDockedChat` picks the param up and auto-submits the template prompt as
 * the first builder-chat turn. The shell, sidebar, search, and filtering all live
 * in `TemplateGalleryDialog`.
 */
export function AgentTemplateDialog({ open, onOpenChange, kind }: AgentTemplateDialogProps) {
  const router = useRouter()
  const { createAgent } = useAgentMutations()
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null)

  // Kind is the primary filter (set by the Create dropdown); the category
  // sidebar is an orthogonal topic filter applied on top by the gallery shell.
  const kindTemplates = useMemo(() => agentTemplates.filter((t) => t.kind === kind), [kind])

  // Reset the busy row whenever the dialog closes.
  useEffect(() => {
    if (!open) setCreatingTemplateId(null)
  }, [open])

  async function handleSelect(template: AgentTemplate) {
    setCreatingTemplateId(template.id)
    const created = await createAgent({ kind: template.kind })
    if (!created) {
      setCreatingTemplateId(null)
      return
    }
    onOpenChange(false)
    router.push(`/app/agents/${created.slug}?template=${template.id}`)
  }

  return (
    <TemplateGalleryDialog<AgentTemplate>
      open={open}
      onOpenChange={onOpenChange}
      title='Create from template'
      description='Select an agent template to scaffold'
      crumbLabel='Agent templates'
      items={kindTemplates}
      categories={constants.agentTemplateCategories}
      renderIcon={(template) => (
        <EntityIcon
          iconId={template.icon}
          color={template.color}
          size='lg'
          inverse
          className='inset-shadow-xs inset-shadow-black/20'
        />
      )}
      onSelectItem={handleSelect}
      busyItemId={creatingTemplateId}
    />
  )
}
