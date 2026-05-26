// apps/web/src/components/channels/hooks/use-default-channel.ts

import { useSettings } from '~/hooks/use-settings'
import { useEmailChannels } from '../store/channel-store'

/**
 * Resolves the user's default sending channel for compose actions.
 *
 * Falls back to the first available channel when the saved channel was
 * deleted / auth-errored away.
 */
export function useDefaultChannelId(): string | undefined {
  const { getSetting } = useSettings({})
  const channels = useEmailChannels()
  const saved = getSetting('compose.defaultIntegrationId') as string | null
  if (saved && channels.some((c) => c.id === saved)) return saved
  return channels[0]?.id
}
