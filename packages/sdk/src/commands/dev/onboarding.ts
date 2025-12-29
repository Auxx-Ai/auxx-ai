// packages/sdk/src/commands/dev/onboarding.ts

/**
 * @file Handles the app installation onboarding flow during development.
 * Polls for app installation status and prompts the user to install if not already installed.
 */

import open from 'open'
import { isErrored } from '../../errors.js'
import { api } from '../../api/api.js'
import { APP_URL } from '../../env.js'

import { listenForKey } from '../../util/listen-for-key.js'

/**
 * Displays a prompt instructing the user to install the app in their workspace.
 * Listens for the "i" key to open the app settings page.
 */
function prompt() {
  process.stdout.write(
    `🚨 IMPORTANT: You will need to install your app in your workspace. Press "i" to open the app settings page, and then click "Install".\n\n`
  )
}

/**
 * Properties required for the onboarding process.
 */
type OnboardingProp = {
  /** The unique identifier of the app */
  appId: string
  /** The URL-friendly slug of the app */
  appSlug: string
  /** Organization details where the app will be installed */
  organization: {
    /** The unique identifier of the organization */
    id: string
    /** The URL-friendly slug of the organization */
    handle: string
  }
}

/**
 * Initiates the onboarding flow for app installation. Polls the API every 60 seconds
 * to check if the app has been installed in the organization's workspace.
 *
 * If the app is not installed, prompts the user to install it and listens for the "i" key
 * to open the app settings page in the browser.
 *
 * @param params - The onboarding parameters
 * @param params.appId - The unique identifier of the app
 * @param params.appSlug - The URL-friendly slug of the app
 * @param params.organization - Organization details including id and slug
 * @returns A cleanup function to stop listening for key presses
 *
 * @example
 * ```typescript
 * const cleanup = onboarding({
 *   appId: 'app_123',
 *   appSlug: 'my-app',
 *   organization: { id: 'org_456', handle: 'my-org' }
 * })
 *
 * // Later, when done:
 * cleanup()
 * ```
 */
export function onboarding({ appId, appSlug, organization }: OnboardingProp) {
  // Listen for "i" key to open app settings page
  const cleanup = listenForKey('i', () => {
    // open(`${APP_URL}/app/${organization.handle}/settings/apps/${appSlug}`)
    open(`${APP_URL}/app/settings/apps/${appSlug}`)
  })

  /**
   * Polls the API to check if the app has been installed.
   * If not installed, prompts the user and continues polling every 60 seconds.
   */
  const poll = async () => {
    const installationResult = await api.fetchInstallation({
      appId,
      organizationId: organization.id,
    })
    if (isErrored(installationResult)) {
      return
    }
    let installation = installationResult.value
    if (!installation) {
      prompt()
      while (!installation) {
        // Poll every 60 seconds
        await new Promise((resolve) => setTimeout(resolve, 60_000))
        const installationResult = await api.fetchInstallation({
          appId,
          organizationId: organization.id,
        })
        if (isErrored(installationResult)) {
          return
        }
        installation = installationResult.value
        if (!installation) {
          prompt()
        }
      }
      cleanup()
    }
  }
  poll()
  return cleanup
}
