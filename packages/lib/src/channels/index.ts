// packages/lib/src/channels/index.ts

export { getOrgChannelProviderMap, invalidateOrgChannelProviderMap } from './cache'
export { PLATFORM_CAPABILITIES, type PlatformCapabilities } from './capabilities'
export { disconnect } from './disconnect'
export { type CreateChannelInput, createChannel, linkChannelToInbox } from './lifecycle'
export { countBillableChannels, getProviderType, list } from './list'
export { registerChannelHooks } from './register-hooks'
export {
  addExcludedSender,
  getSettings,
  updateAllowedSenders,
  updateSettings,
} from './settings'
export { getAllStats } from './stats'
export { syncAllMessages, syncMessages } from './sync'
export { toggle } from './toggle'
export type { ChannelCtx, ChannelSettings } from './types'
