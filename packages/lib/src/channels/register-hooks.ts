// packages/lib/src/channels/register-hooks.ts
// Registers the channel post-connect provisioning hook into the connections registry.
// Called once at app boot (web + worker) — both processes resolve the generic OAuth
// callback / run channel sync, so both need the hook registered.

import { registerPostConnectHook } from '../connections/post-connect-hooks'
import { channelProvisioningHook } from './provisioning-hook'
import { socialProvisioningHook } from './social-provisioning-hook'

let registered = false

/** Register channel post-connect provisioning hooks. Idempotent. */
export function registerChannelHooks(): void {
  if (registered) return
  registered = true
  registerPostConnectHook(channelProvisioningHook)
  registerPostConnectHook(socialProvisioningHook)
}
