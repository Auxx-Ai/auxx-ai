// packages/lib/src/channels/client.ts
//
// Client-safe re-exports from the channels module. The main `./index.ts`
// pulls in `./sync` (bullmq, sharp, etc.) via re-exports — use this entry
// in client components that only need static capability metadata.

export {
  CHANNEL_GROUP_LABELS,
  CHANNEL_GROUP_OPTIONS,
  type ChannelGroup,
  type ChannelSelectionScope,
  type ComposerCapabilities,
  canStartOutbound,
  channelGroupForProvider,
  getComposerCapabilities,
  identifierTypeForProvider,
  PLATFORM_CAPABILITIES,
  type PlatformCapabilities,
  providersForChannelGroup,
} from './capabilities'
