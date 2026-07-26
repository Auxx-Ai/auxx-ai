// apps/web/src/components/agents/ui/detail/permissions/publish-clamp-dialog.tsx
'use client'

import type { AgentPolicyClampEntry } from '@auxx/database'
import { type Area, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd } from '@auxx/ui/components/kbd'
import { ShieldAlert } from 'lucide-react'
import { useResources } from '~/components/resources/hooks'
import { agentLevelLabel } from './agent-access-level'

interface PublishClampDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The reductions `agent.publish` reports, empty when nothing was clamped. */
  reductions: AgentPolicyClampEntry[]
  versionNumber: number | null
}

/**
 * What the §2.4a author clamp actually did, shown immediately after publish.
 *
 * `publishedPolicy = min(resolvedProfilePolicy, publisherEffectiveCapabilities)`
 * is applied per area, per record type and per resource instance — and §2.4a is
 * explicit that silence here is the worst option, because the reduction will
 * otherwise surface later as *"my agent can't do what I told it to"*. So every
 * reduction is named in the plan's own words: **"Deals reduced from Full to Read
 * — you hold Read."**
 */
export function PublishClampDialog({
  open,
  onOpenChange,
  reductions,
  versionNumber,
}: PublishClampDialogProps) {
  const { resources } = useResources()

  const labelFor = (entry: AgentPolicyClampEntry): string => {
    if (entry.key === null) {
      return entry.domain === 'area'
        ? 'Every other area'
        : entry.domain === 'definition'
          ? 'Every other record type'
          : 'Every other resource'
    }
    if (entry.domain === 'area') {
      return PERMISSION_AREAS[entry.key as Area]?.label ?? entry.key
    }
    if (entry.domain === 'definition') {
      return resources.find((r) => r.apiSlug === entry.key)?.plural ?? entry.key
    }
    return entry.key
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ShieldAlert className='size-4' />
            Published with reduced access
          </DialogTitle>
          <DialogDescription>
            {versionNumber ? `Version ${versionNumber} ` : 'This version '}
            was published under your own access. An agent can never be published above the authority
            of the person publishing it, so these rungs were reduced — the profile itself is
            unchanged.
          </DialogDescription>
        </DialogHeader>

        <ul className='flex flex-col gap-1.5 text-sm'>
          {reductions.map((entry) => (
            <li
              key={`${entry.domain}:${entry.key ?? '__default__'}`}
              className='rounded-md bg-primary-50 px-3 py-2'>
              <strong>{labelFor(entry)}</strong> reduced from {agentLevelLabel(entry.from)} to{' '}
              {agentLevelLabel(entry.to)} — you hold {agentLevelLabel(entry.to)}.
            </li>
          ))}
        </ul>

        <p className='text-xs text-muted-foreground'>
          To publish this agent at the level the profile asks for, have an owner or admin publish it
          — republishing re-applies the clamp against whoever publishes.
        </p>

        <DialogFooter>
          <Button
            variant='outline'
            size='sm'
            onClick={() => onOpenChange(false)}
            data-dialog-submit>
            Got it <Kbd shortcut='esc' variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
