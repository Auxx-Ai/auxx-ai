// packages/lib/src/channels/index.ts

export { getOrgChannelProviderMap, invalidateOrgChannelProviderMap } from './cache'
export { PLATFORM_CAPABILITIES, type PlatformCapabilities } from './capabilities'
export { disconnect } from './disconnect'
export {
  addOpenPhoneChannel,
  type CreateChannelInput,
  createChannel,
  linkChannelToInbox,
} from './lifecycle'
export { getProviderType, list } from './list'
export { getAuthUrl } from './oauth'
export {
  addExcludedSender,
  getSettings,
  updateAllowedSenders,
  updateSettings,
} from './settings'
export { getAllStats } from './stats'
export { syncAllMessages, syncMessages } from './sync'
export { toggle } from './toggle'
export type { ChannelCtx, ChannelSettings, OpenPhoneInput } from './types'
