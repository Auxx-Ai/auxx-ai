// apps/web/src/components/manufacturing/ui/settings/build-switch-exclusivity.ts

import type { SettingValue } from '@auxx/lib/settings/client'

/** 111 Q14: backflush and order-raised auto-builds never run together; the write refuses both on. */
export const EXCLUSIVE_BUILD_SWITCHES = {
  'inventory.backflush': 'inventory.autoBuildFromOrders',
  'inventory.autoBuildFromOrders': 'inventory.backflush',
} as const

export const BUILD_SWITCH_EXCLUSIVITY_SENTENCE =
  'Backflush and order-raised builds cannot both be on: turning one on turns the other off.'

/** The draft patch for flipping one switch: turning it on turns its partner off in the same patch. */
export function applyBuildSwitchExclusivity(
  key: string,
  value: SettingValue
): Record<string, SettingValue> {
  const other = EXCLUSIVE_BUILD_SWITCHES[key as keyof typeof EXCLUSIVE_BUILD_SWITCHES]
  if (!other || value !== true) return { [key]: value }
  return { [key]: true, [other]: false }
}
