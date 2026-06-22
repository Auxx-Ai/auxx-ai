// apps/web/src/components/apps/ui/connection-display.ts
import type { useAppsContext } from '~/components/apps/providers/apps-context'
import type { PickerConnection } from './connection-picker'

type AppInstallations = ReturnType<typeof useAppsContext>['appInstallations']

/** Fallback icons when a connection carries no resolved icon. */
const APP_FALLBACK_ICON = 'package'
const KEY_FALLBACK_ICON = 'key-round'

/**
 * Resolve a connection row to its display identity (icon + title).
 *
 * App rows get their installed app's logo + title (hydrated client-side, since
 * `avatarUrl` isn't a credential column); non-app rows use the provider brand
 * mark `connections.list` resolved on `icon`, else a neutral key fallback.
 * Title prefers the user-set `label`, then the app title, then the raw `name`.
 *
 * Shared by the connection picker, its popover trigger, and the data-connector
 * connection section so every surface renders the same icon/name.
 */
export function resolveConnectionDisplay(
  connection: PickerConnection,
  appInstallations: AppInstallations
): { iconId: string; title: string } {
  const inst = connection.appId
    ? appInstallations.find((i) => i.app.id === connection.appId)
    : undefined
  const fallback =
    connection.kind === 'app' ? APP_FALLBACK_ICON : (connection.icon ?? KEY_FALLBACK_ICON)
  return {
    iconId: inst?.app.avatarUrl ?? fallback,
    title: connection.label ?? inst?.app.title ?? connection.name,
  }
}
