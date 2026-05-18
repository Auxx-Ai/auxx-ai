// apps/web/src/components/agents/ui/list/create-agent-button.tsx
'use client'

import { AnimatedGradientText } from '@auxx/ui/components/animated-gradient-text'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Bot, LayoutTemplate, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import { AgentTemplateDialog } from '../dialogs/agent-template-dialog'

/**
 * Dropdown trigger for creating an agent: scratch (immediate draft + route) or
 * template (opens the template dialog). Mirrors `CreateWorkflowButton`'s
 * pattern — gradient styling on the "Create from template" item to nudge
 * admins toward starter prompts.
 */
export function CreateAgentButton() {
  const router = useRouter()
  const { createAgent, isCreating } = useAgentMutations()
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)

  const isBusy = isCreating || isRedirecting

  const handleCreateFromScratch = useCallback(async () => {
    setIsRedirecting(true)
    const created = await createAgent()
    if (!created) {
      setIsRedirecting(false)
      return
    }
    router.push(`/app/agents/${created.slug}`)
    // Keep isRedirecting true — the unmount when the new page replaces
    // this one tears down the state. Clearing it now would flash the
    // button back to idle while the next route bootstraps.
  }, [createAgent, router])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size='sm' loading={isBusy} loadingText='Creating…'>
            <Plus />
            Create agent
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-50'>
          <DropdownMenuItem onClick={handleCreateFromScratch} disabled={isBusy}>
            <Bot />
            Create from scratch
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setTemplateDialogOpen(true)}
            disabled={isBusy}
            className='data-highlighted:bg-[#ffaa40]/10'>
            <LayoutTemplate className='text-[#ffaa40]' />
            <AnimatedGradientText>Create from template</AnimatedGradientText>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AgentTemplateDialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen} />
    </>
  )
}
