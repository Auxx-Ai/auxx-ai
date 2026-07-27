// apps/web/src/components/agents/ui/detail/permissions/author-clamp-notice.tsx
'use client'

import type { AgentPermissionPolicy } from '@auxx/database'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { ShieldAlert } from 'lucide-react'
import { agentLevelLabel } from '~/components/permissions/ui/level-labels'
import { useAuthorClampPreview } from './use-author-clamp-preview'

/**
 * The §2.4a **author clamp**, named before it bites — and silent when it doesn't.
 *
 * `publishedPolicy = min(resolvedProfilePolicy, publisherEffectiveCapabilities)`.
 * §2.4a requires every reduction to be named rather than silently applied, so a
 * `Read`-only member learns *before* publishing that they cannot mint a
 * write-capable agent (and that an owner or admin publishing instead would not be
 * reduced). `PublishClampDialog` then reports what the server actually applied;
 * the server is authoritative and this is only a preview.
 */
export function AuthorClampNotice({ policy }: { policy: AgentPermissionPolicy | null }) {
  const { rows } = useAuthorClampPreview(policy)

  // Nothing to say when nothing is reduced — which includes an OWNER/ADMIN
  // publisher, for whom the preview returns no rows at all.
  if (!policy || rows.length === 0) return null

  return (
    <Alert variant='warning'>
      <ShieldAlert className='size-4' />
      <AlertTitle>Publishing will reduce this policy to your own access</AlertTitle>
      <AlertDescription>
        <span>
          An agent can never be published above the authority of the person publishing it. If you
          publish now, these rungs are reduced — the profile itself is left alone, and an owner or
          admin publishing instead would not be reduced:
        </span>
        <ul className='mt-2 flex flex-col gap-1'>
          {rows.map((row) => (
            <li key={`${row.domain}:${row.label}`}>
              <strong>{row.label}</strong> reduced from {agentLevelLabel(row.from)} to{' '}
              {agentLevelLabel(row.to)} — you hold {agentLevelLabel(row.to)}.
            </li>
          ))}
        </ul>
        <span className='mt-2 block text-xs'>
          Resource-instance reductions are reported after publishing.
        </span>
      </AlertDescription>
    </Alert>
  )
}
