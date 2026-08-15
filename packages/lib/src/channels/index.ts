// packages/lib/src/channels/index.ts

export {
  getOrgChannelProviderMap,
  getOrgOwnEmailAddresses,
  invalidateOrgChannelProviderMap,
} from './cache'
export {
  type ChannelSelectionScope,
  type ComposerCapabilities,
  canStartOutbound,
  getComposerCapabilities,
  PLATFORM_CAPABILITIES,
  type PlatformCapabilities,
} from './capabilities'
export {
  CHANNEL_PROVIDER_TO_KEY,
  channelProviderKey,
  resolveChannelDefinitionId,
} from './channel-connection-def'
export { assertSharedConnectInbox } from './connect-inbox'
export { disconnect } from './disconnect'
export { type CreateChannelInput, createChannel, linkChannelToInbox } from './lifecycle'
export { countBillableChannels, getProviderType, list } from './list'
export {
  type ChannelManageScope,
  canManageChannel,
  listManageableChannelIds,
  requireChannelManageAccess,
} from './manage-access'
export { buildOrgOwnEmailAddressSet } from './own-addresses'
export {
  claimPersonalInbox,
  deleteOwnPersonalInbox,
  deletePersonalInbox,
  disconnectPersonalChannelsForUser,
  provisionPersonalInbox,
  supportsPersonalChannelConnection,
} from './personal-connection'
export {
  listQuoPhoneNumbers,
  type ProvisionQuoChannelInput,
  provisionQuoChannel,
  readCachedQuoNumbers,
} from './quo-channel'
export { type RecoverChannelResult, recoverChannel } from './recover'
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
