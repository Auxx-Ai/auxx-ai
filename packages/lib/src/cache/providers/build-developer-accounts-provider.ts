// packages/lib/src/cache/providers/build-developer-accounts-provider.ts

import {
  listDeveloperAccountMembers,
  listDeveloperAccounts,
} from '@auxx/services/developer-accounts'
import { createScopedLogger } from '../../logger'
import type { BuildCachedDeveloperAccount } from '../build-user-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

const logger = createScopedLogger('build-dev-accounts-provider')

/**
 * Computes developer accounts + members for a user.
 * NOTE: N+1 query pattern (fetches members per account). Acceptable because
 * this is cached with a long TTL and most users have few accounts.
 */
export const buildDeveloperAccountsProvider: CacheProvider<BuildCachedDeveloperAccount[]> = {
  async compute(userId) {
    const result = await listDeveloperAccounts({ userId })

    if (result.isErr()) {
      logger.error('Failed to fetch developer accounts', { error: result.error, userId })
      throw new Error(`Failed to fetch developer accounts: ${result.error.message}`)
    }

    const accounts = await Promise.all(
      result.value.accounts.map(async (account) => {
        const membersResult = await listDeveloperAccountMembers({
          developerAccountId: account.id,
          userId,
        })

        if (membersResult.isErr()) {
          logger.error('Failed to fetch members for developer account', {
            error: membersResult.error,
            developerAccountId: account.id,
          })
          throw new Error(
            `Failed to fetch members for account ${account.id}: ${membersResult.error.message}`
          )
        }

        const { members, userMember } = membersResult.value

        return {
          id: account.id,
          title: account.title,
          slug: account.slug,
          logoId: account.logoId,
          logoUrl: account.logoUrl,
          featureFlags: account.featureFlags,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          userMember: {
            id: userMember.id,
            userId: userMember.userId,
            accessLevel: userMember.accessLevel as 'admin' | 'member',
            createdAt: userMember.createdAt,
          },
          members: members.map((m) => ({
            id: m.id,
            userId: m.userId,
            userName: m.user.name,
            userEmail: m.user.email,
            userImage: m.user.image,
            accessLevel: m.accessLevel as 'admin' | 'member',
            createdAt: m.createdAt,
          })),
        }
      })
    )

    return accounts
  },
}
