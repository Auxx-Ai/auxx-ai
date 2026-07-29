// apps/web/src/app/(protected)/app/mail/layout.tsx

import type React from 'react'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'

type Props = { children: React.ReactNode }

/**
 * The mail surface's front door (plan 40 §5.3). Placed on the LAYOUT, not the
 * index page, so every nested mailbox route — `[type]/[status]`, `inboxes/…`,
 * `personal/…`, `shared/…`, `views/…`, `tags/…`, `drafts`, `sent` — inherits it;
 * a per-page guard would leave a deep-linked thread URL open.
 *
 * Marker-style (no children): a denied member is redirected to `/access-denied`
 * rather than rendering an empty mailbox shell. Matches `settings/inbox`, which
 * has carried the same guard on `channels.manage` since plan 21.
 *
 * `inboxes.view` is a coarse door, not an inbox answer — the per-inbox floor and
 * the per-thread lens still decide what is inside (§1.4). A member at area `None`
 * holding one explicit inbox `view` row holds the key by derivation and gets in.
 */
async function MailLayout({ children }: Props) {
  return (
    <div className='flex flex-1 min-h-0 flex-col w-full bg-neutral-100 dark:bg-primary-100'>
      <CapabilityPageGuard permissionKey='inboxes.view' />
      {children}
    </div>
  )
}

export default MailLayout
