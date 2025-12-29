// apps/web/src/lib/extensions/extension-hooks.ts

/**
 * Platform-side hooks for working with extensions
 *
 * These hooks are used by the platform when rendering extension content
 * or interacting with extension data.
 *
 * Per Plan 7: These are NOT the same as the client hooks in @auxx/sdk/client.
 * These are for the platform's internal use when working with extensions.
 */

import { useExtensionsContext } from '~/providers/extensions/extensions-context'

/**
 * Hook to get settings for a specific extension installation.
 * Returns React Query-style result.
 *
 * Note: Settings are not currently included in the AppInstallation type.
 * This hook returns an empty object as a placeholder for future implementation.
 *
 * @param appId - The app ID
 * @param appInstallationId - The installation ID
 * @returns The extension settings object with loading states
 *
 * @example
 * ```tsx
 * function ExtensionWidget({ appId, appInstallationId }) {
 *   const { data: settings, isLoading } = useExtensionSettings(appId, appInstallationId)
 *   if (isLoading) return <div>Loading...</div>
 *   return <div>API Key: {settings.apiKey}</div>
 * }
 * ```
 */
export function useExtensionSettings(appId: string, appInstallationId: string) {
  const { isLoading, isError } = useExtensionsContext()

  // TODO: Settings are not currently part of the AppInstallation response
  // This will need to be implemented when app settings are added to the API
  const settings = {}

  return {
    data: settings,
    isLoading,
    isError,
    isSuccess: !isLoading && !isError,
  }
}

/**
 * Hook to get a specific extension installation.
 * Returns React Query-style result.
 *
 * @param appInstallationId - The installation ID
 * @returns The extension installation with loading states
 */
export function useExtensionInstallation(appInstallationId: string) {
  const { appInstallations, isLoading, isError } = useExtensionsContext()

  const installation = appInstallations.find((i) => i.installationId === appInstallationId)

  return {
    data: installation,
    isLoading,
    isError,
    isSuccess: !isLoading && !isError,
  }
}

/**
 * Hook to get all installed extensions.
 * Returns React Query-style result.
 *
 * @returns Array of all extension installations with loading states
 */
export function useInstalledExtensions() {
  const { appInstallations, isLoading, isError } = useExtensionsContext()

  return {
    data: appInstallations,
    isLoading,
    isError,
    isSuccess: !isLoading && !isError,
  }
}

/**
 * Hook to check if a specific extension is installed.
 * Returns React Query-style result.
 *
 * @param appId - The app ID to check
 * @returns True if the extension is installed with loading states
 */
export function useIsExtensionInstalled(appId: string) {
  const { appInstallations, isLoading, isError } = useExtensionsContext()

  const isInstalled = appInstallations.some((i) => i.app.id === appId)

  return {
    data: isInstalled,
    isLoading,
    isError,
    isSuccess: !isLoading && !isError,
  }
}
