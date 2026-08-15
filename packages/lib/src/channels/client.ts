// packages/lib/src/channels/client.ts
//
// Client-safe re-exports from the channels module. The main `./index.ts`
// pulls in `./sync` (bullmq, sharp, etc.) via re-exports — use this entry
// in client components that only need static capability metadata.

export {
  type ChannelSelectionScope,
  type ComposerCapabilities,
  canStartOutbound,
  getComposerCapabilities,
  PLATFORM_CAPABILITIES,
  type PlatformCapabilities,
} from './capabilities'
