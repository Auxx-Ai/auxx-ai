// apps/web/src/components/agents/ui/list/create-agent-button.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { AnimatedGradientText } from '@auxx/ui/components/animated-gradient-text'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Bot, LayoutTemplate, MessageCircle, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import { useAgentStore } from '../../store/agent-store'
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
  const [templateKind, setTemplateKind] = useState<'internal' | 'chat'>('internal')
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)

  const { isAtLimit, getLimit } = useFeatureFlags()
  const agentCount = useAgentStore(
    (s) => s.agents.filter((a) => !s.optimisticArchived.has(a.id)).length
  )
  const atLimit = isAtLimit(FeatureKey.agentsLimit, agentCount)
  const agentLimit = getLimit(FeatureKey.agentsLimit)

  const isBusy = isCreating || isRedirecting

  const handleCreateFromScratch = useCallback(
    async (kind: 'internal' | 'chat') => {
      setIsRedirecting(true)
      const created = await createAgent({ kind })
      if (!created) {
        setIsRedirecting(false)
        return
      }
      router.push(`/app/agents/${created.slug}`)
      // Keep isRedirecting true — the unmount when the new page replaces
      // this one tears down the state. Clearing it now would flash the
      // button back to idle while the next route bootstraps.
    },
    [createAgent, router]
  )

  const openTemplateDialog = useCallback((kind: 'internal' | 'chat') => {
    setTemplateKind(kind)
    setTemplateDialogOpen(true)
  }, [])

  // No allowance on the current plan — gate creation behind an upgrade prompt.
  if (atLimit) {
    const hasNoAllowance = agentLimit === 0 || agentLimit === false
    return (
      <>
        <Button size='sm' onClick={() => setLimitDialogOpen(true)}>
          <Plus />
          Create agent
        </Button>
        <LimitReachedDialog
          open={limitDialogOpen}
          onOpenChange={setLimitDialogOpen}
          icon={Bot}
          title={hasNoAllowance ? 'Agents Not Available' : 'Agent Limit Reached'}
          description={
            hasNoAllowance
              ? 'Creating AI agents isn’t included in your current plan. Upgrade to build your own agents.'
              : `You've reached the maximum of ${agentLimit} agents on your current plan.`
          }
        />
      </>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size='sm' loading={isBusy} loadingText='Creating…'>
            <Plus />
            Create agent
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-56'>
          <DropdownMenuLabel className='text-xs text-muted-foreground'>
            Internal agent
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => handleCreateFromScratch('internal')} disabled={isBusy}>
            <Bot />
            Create from scratch
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => openTemplateDialog('internal')}
            disabled={isBusy}
            className='data-highlighted:bg-[#ffaa40]/10'>
            <LayoutTemplate className='text-[#ffaa40]' />
            <AnimatedGradientText>Create from template</AnimatedGradientText>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuLabel className='text-xs text-muted-foreground'>
            Chat agent
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => handleCreateFromScratch('chat')} disabled={isBusy}>
            <MessageCircle />
            Create from scratch
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => openTemplateDialog('chat')}
            disabled={isBusy}
            className='data-highlighted:bg-[#ffaa40]/10'>
            <LayoutTemplate className='text-[#ffaa40]' />
            <AnimatedGradientText>Create from template</AnimatedGradientText>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AgentTemplateDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        kind={templateKind}
      />
    </>
  )
}
