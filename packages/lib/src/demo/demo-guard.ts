// packages/lib/src/demo/demo-guard.ts

import { ForbiddenError } from '../errors'

/**
 * Guard that blocks restricted actions for demo organizations.
 * Uses the org profile from cache to check demo status without a DB hit.
 */
export class DemoGuard {
  /**
   * Throws ForbiddenError if the org is a demo org and the action is blocked.
   * @param orgId - The organization ID to check
   * @param action - A human-readable description of the blocked action (e.g. "send emails")
   */
  static async requireNotDemo(
    orgId: string,
    action: string,
    isSuperAdmin?: boolean
  ): Promise<void> {
    if (isSuperAdmin) return

    const { getOrgCache } = await import('../cache/singletons')
    const orgProfile = await getOrgCache().get(orgId, 'orgProfile')

    if (orgProfile?.demoExpiresAt) {
      throw new ForbiddenError(
        `This action is not available in demo mode. Sign up for a free account to ${action}.`,
        { code: 'DEMO_RESTRICTED', action }
      )
    }
  }
}
