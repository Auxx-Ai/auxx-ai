// apps/web/src/components/channels/hooks/use-default-channel.ts

import type { ChannelSelectionScope } from '@auxx/lib/channels/client'
import { useSettings } from '~/hooks/use-settings'
import { useSendableChannels } from '../store/channel-store'

/**
 * Resolves the user's default sending channel for compose actions.
 *
 * Falls back to the first available channel when the saved channel was
 * deleted / auth-errored away.
 *
 * `scope` must match the picker this feeds. Resolving against an email-only
 * list while the picker offers phone channels silently discards a saved SMS
 * default — the star button would appear to do nothing, because the saved id
 * is never found in `channels` and the fallback picks the first email channel
 * instead.
 */
export function useDefaultChannelId(scope: ChannelSelectionScope = 'email'): string | undefined {
  const { getSetting } = useSettings({})
  const channels = useSendableChannels(scope)
  const emailOnly = useSendableChannels('email')
  const saved = getSetting('compose.defaultIntegrationId') as string | null
  if (saved && channels.some((c) => c.id === saved)) return saved
  // No explicit choice: prefer email. `channels` is in org-cache insertion
  // order, so falling straight through to `channels[0]` would open the composer
  // on SMS for any org that happened to connect a phone channel first.
  return emailOnly[0]?.id ?? channels[0]?.id
}
