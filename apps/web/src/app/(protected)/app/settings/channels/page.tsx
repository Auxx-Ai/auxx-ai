// apps/web/src/app/(protected)/app/settings/channels/page.tsx

import { ChannelsPage } from '~/components/channels/ui/channels-page'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'

/**
 * Channels settings — list + inbox-first gallery connect (channels v2).
 *
 * `channels.manage`, matching `settings/inbox`: this page IS the mail-inventory
 * surface (connect/disconnect channels, route them to inboxes), which plan 40
 * §1.0 puts squarely on that key. It carried NO page guard at all until plan 40
 * phase 3 — a UI gap rather than a hole, since every `channel.*` / `inbox.*`
 * mutation behind it is already gated (phase 0a), but a member without the key
 * still got the full settings shell and a wall of 403s.
 */
export default function ChannelsSettingsPage() {
  return (
    <>
      <CapabilityPageGuard permissionKey='channels.manage' />
      <ChannelsPage />
    </>
  )
}
