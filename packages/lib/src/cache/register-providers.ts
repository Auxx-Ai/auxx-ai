// packages/lib/src/cache/register-providers.ts

import type { AppCacheService } from './app-cache-service'
import type { BuildUserCacheService } from './build-user-cache-service'
import type { OrganizationCacheService } from './org-cache-service'
import { aiCredentialsProvider } from './providers/ai-credentials-provider'
import { aiDefaultModelsProvider } from './providers/ai-default-models-provider'
import { aiProviderConfigsProvider } from './providers/ai-provider-configs-provider'
import { appSlugMapProvider } from './providers/app-slug-map-provider'
// Build user cache providers
import { buildAppsProvider } from './providers/build-apps-provider'
import { buildDeveloperAccountsProvider } from './providers/build-developer-accounts-provider'
import { buildOrganizationsProvider } from './providers/build-organizations-provider'
import { channelProvidersProvider } from './providers/channel-providers-provider'
import { customFieldsProvider } from './providers/custom-fields-provider'
import { entityDefSlugsProvider } from './providers/entity-def-slugs-provider'
import { entityDefsProvider } from './providers/entity-defs-provider'
import { featuresProvider } from './providers/features-provider'
import { groupsProvider } from './providers/groups-provider'
import { inboxesProvider } from './providers/inboxes-provider'
import { installedAppsProvider } from './providers/installed-apps-provider'
import { integrationsProvider } from './providers/integrations-provider'
import { memberRoleMapProvider, membersProvider } from './providers/members-provider'
import { orgProfileProvider } from './providers/org-profile-provider'
import { orgSettingsProvider } from './providers/org-settings-provider'
import { overagesProvider } from './providers/overages-provider'
import { planMapProvider } from './providers/plan-map-provider'
import { plansProvider } from './providers/plans-provider'
import { publishedAppsProvider } from './providers/published-apps-provider'
import { resourcesProvider } from './providers/resources-provider'
import { subscriptionProvider } from './providers/subscription-provider'
import { systemUserProvider } from './providers/system-user-provider'
import { userFavoritesProvider } from './providers/user-favorites-provider'
import { userMailViewsProvider } from './providers/user-mail-views-provider'
import { userMembershipsProvider } from './providers/user-memberships-provider'
import { userProfileProvider } from './providers/user-profile-provider'
import { userSettingsProvider } from './providers/user-settings-provider'
import { userTableViewsProvider } from './providers/user-table-views-provider'
import { workflowAppsProvider } from './providers/workflow-apps-provider'
import { workflowTemplatesProvider } from './providers/workflow-templates-provider'
import type { UserCacheService } from './user-cache-service'

/** Register all cache providers. Called once at service startup. */
export function registerAllProviders(
  orgCache: OrganizationCacheService,
  userCache: UserCacheService,
  appCache: AppCacheService,
  buildUserCache: BuildUserCacheService
): void {
  // Org-scoped: near-immutable
  orgCache.register('entityDefs', entityDefsProvider)
  orgCache.register('entityDefSlugs', entityDefSlugsProvider)
  orgCache.register('systemUser', systemUserProvider)
  orgCache.register('channelProviders', channelProvidersProvider)

  // Org-scoped: membership & permissions
  orgCache.register('members', membersProvider)
  orgCache.register('memberRoleMap', memberRoleMapProvider)

  // Org-scoped: business data
  orgCache.register('features', featuresProvider)
  orgCache.register('subscription', subscriptionProvider)
  orgCache.register('orgProfile', orgProfileProvider)
  orgCache.register('resources', resourcesProvider)
  orgCache.register('customFields', customFieldsProvider)
  orgCache.register('groups', groupsProvider)
  orgCache.register('inboxes', inboxesProvider)
  orgCache.register('integrations', integrationsProvider)
  orgCache.register('overages', overagesProvider)
  orgCache.register('orgSettings', orgSettingsProvider)
  orgCache.register('installedApps', installedAppsProvider)
  orgCache.register('workflowApps', workflowAppsProvider)

  // Org-scoped: AI provider data
  orgCache.register('aiProviderConfigs', aiProviderConfigsProvider)
  orgCache.register('aiCredentials', aiCredentialsProvider)
  orgCache.register('aiDefaultModels', aiDefaultModelsProvider)

  // User-scoped
  userCache.register('userProfile', userProfileProvider)
  userCache.register('userSettings', userSettingsProvider)
  userCache.register('userMemberships', userMembershipsProvider)
  userCache.register('userMailViews', userMailViewsProvider)
  userCache.register('userTableViews', userTableViewsProvider)
  userCache.register('userFavorites', userFavoritesProvider)

  // App-scoped (global)
  appCache.register('plans', plansProvider)
  appCache.register('planMap', planMapProvider)
  appCache.register('workflowTemplates', workflowTemplatesProvider)
  appCache.register('appSlugMap', appSlugMapProvider)
  appCache.register('publishedApps', publishedAppsProvider)

  // Build-user-scoped
  buildUserCache.register('buildDeveloperAccounts', buildDeveloperAccountsProvider)
  buildUserCache.register('buildApps', buildAppsProvider)
  buildUserCache.register('buildOrganizations', buildOrganizationsProvider)
}
