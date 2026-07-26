// apps/web/src/components/permissions/ui/agent-policy-clamp-preview.tsx
'use client'

import { Alert } from '@auxx/ui/components/alert'
import { ShieldAlert } from 'lucide-react'
import type { AgentPolicyClampPreviewEntry } from '../hooks/use-agent-policy-clamp'
import { CLAMP_PREVIEW, clampSentence } from './agent-policy-copy'

/**
 * The §2.4a author clamp, disclosed while the policy is being authored.
 *
 * The rule is `publishedPolicy = min(profilePolicy, publisher's own effective
 * capabilities)`. A read-only member cannot mint a write-capable agent — that is
 * the point of the clamp, and the plan is explicit that it "will surface as *my
 * agent can't do what I told it to*, so the publish UI must show the clamp
 * explicitly, never silently downgrade".
 *
 * This block is the authoring-time half of that duty. The publish-time half — the
 * authoritative list, computed server-side and recorded on
 * `AgentVersion.permissionPolicy.clamp` — belongs to the agent-builder track and
 * must render the same sentence shape.
 */
/** How many reductions are listed before the rest are summarized. */
const MAX_LISTED = 12

export function AgentPolicyClampPreview({ entries }: { entries: AgentPolicyClampPreviewEntry[] }) {
  if (entries.length === 0) return null

  const listed = entries.slice(0, MAX_LISTED)
  const hidden = entries.length - listed.length

  return (
    <Alert variant='warning' className='flex gap-3'>
      <ShieldAlert className='size-4 shrink-0' />
      <div className='flex min-w-0 flex-col gap-1'>
        <span className='font-medium'>{CLAMP_PREVIEW.title}</span>
        <span className='opacity-90'>{CLAMP_PREVIEW.body}</span>
        <ul className='mt-1 flex flex-col gap-0.5'>
          {listed.map((entry) => (
            <li key={`${entry.domain}:${entry.key}`}>
              {clampSentence(entry.label, entry.from, entry.to)}
            </li>
          ))}
          {hidden > 0 ? <li>…and {hidden} more.</li> : null}
        </ul>
      </div>
    </Alert>
  )
}
