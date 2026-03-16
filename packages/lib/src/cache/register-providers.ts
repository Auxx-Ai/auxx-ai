// packages/lib/src/cache/register-providers.ts

import type { OrganizationCacheService } from './org-cache-service'
import { customFieldsProvider } from './providers/custom-fields-provider'
import { entityDefSlugsProvider } from './providers/entity-def-slugs-provider'
import { entityDefsProvider } from './providers/entity-defs-provider'
import { featuresProvider } from './providers/features-provider'
import { inboxesProvider } from './providers/inboxes-provider'
import { integrationProvidersProvider } from './providers/integration-providers-provider'
import { memberRoleMapProvider, membersProvider } from './providers/members-provider'
import { orgProfileProvider } from './providers/org-profile-provider'
import { overagesProvider } from './providers/overages-provider'
import { resourcesProvider } from './providers/resources-provider'
import { subscriptionProvider } from './providers/subscription-provider'
import { systemUserProvider } from './providers/system-user-provider'
import { userMailViewsProvider } from './providers/user-mail-views-provider'
import { userMembershipsProvider } from './providers/user-memberships-provider'
import { userProfileProvider } from './providers/user-profile-provider'
import { userSettingsProvider } from './providers/user-settings-provider'
import type { UserCacheService } from './user-cache-service'

/** Register all cache providers. Called once at service startup. */
export function registerAllProviders(
  orgCache: OrganizationCacheService,
  userCache: UserCacheService
): void {
  // Org-scoped: near-immutable
  orgCache.register('entityDefs', entityDefsProvider)
  orgCache.register('entityDefSlugs', entityDefSlugsProvider)
  orgCache.register('systemUser', systemUserProvider)
  orgCache.register('integrationProviders', integrationProvidersProvider)

  // Org-scoped: membership & permissions
  orgCache.register('members', membersProvider)
  orgCache.register('memberRoleMap', memberRoleMapProvider)

  // Org-scoped: business data
  orgCache.register('features', featuresProvider)
  orgCache.register('subscription', subscriptionProvider)
  orgCache.register('orgProfile', orgProfileProvider)
  orgCache.register('resources', resourcesProvider)
  orgCache.register('customFields', customFieldsProvider)
  orgCache.register('inboxes', inboxesProvider)
  orgCache.register('overages', overagesProvider)

  // User-scoped
  userCache.register('userProfile', userProfileProvider)
  userCache.register('userSettings', userSettingsProvider)
  userCache.register('userMemberships', userMembershipsProvider)
  userCache.register('userMailViews', userMailViewsProvider)
}
