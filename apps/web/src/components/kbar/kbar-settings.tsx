// src/components/kbar/kbar-settings.tsx

import { type Action, useRegisterActions } from 'kbar'
import { useRouter } from 'next/navigation'
import React from 'react'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/**
 * useKbarSettings hook
 * Registers Kbar actions for navigating to settings pages.
 * Adds admin actions if user is admin/owner.
 */
const useKbarSettings = () => {
  const router = useRouter()
  const { isAdminOrOwner } = useUser()

  /**
   * Navigates to a specific settings page.
   * @param page - The settings page path.
   */
  const goToSetting = (page: string) => {
    router.push(`/app/settings${page}`)
  }
  // const goTo = (page: string) => {
  //   router.push(`/app/${page}`)
  // }

  // Base settings actions
  const settingsActions = [
    {
      id: 'goToSettings',
      name: 'Settings',
      subtitle: 'View your settings',
      icon: 'settings',
      shortcut: ['s', 'g'],
      section: 'Navigation',
      perform: () => goToSetting('/general'),
    },

    {
      id: 'goToGeneralSettings',
      name: 'General Settings',
      icon: 'settings',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/general'),
    },
    {
      id: 'goToOrganizationSettings',
      name: 'Organization Settings',
      icon: 'building',
      shortcut: ['s', 'o'],
      keywords: 'organization',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/organization'),
    },
    {
      id: 'goToSnippetsSettings',
      name: 'Snippets Settings',
      icon: 'braces',
      shortcut: ['s', 'n'],
      keywords: 'snippets',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/snippets'),
    },
    {
      id: 'goToSignaturesSettings',
      name: 'Signatures Settings',
      icon: 'pen-tool',
      shortcut: ['s', 's'],
      keywords: 'signatures',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/signatures'),
    },
    {
      id: 'goToSignaturesCreate',
      name: 'Create Signature',
      icon: 'plus',
      shortcut: ['s', 's', 'c'],
      keywords: 'signatures',
      section: 'Signatures',
      parent: 'goToSettings',
      perform: () => goToSetting('/signatures/new'),
    },
  ]

  // Admin-only settings actions

  // Combine actions if admin/owner
  // const allActions = isAdminOrOwner
  //   ? [...settingsActions, ...adminSettingsActions]
  //   : settingsActions

  useRegisterActions(settingsActions)
}

export default useKbarSettings

/**
 * useKbarAdminSettings hook
 * Registers Kbar admin actions if user is admin/owner.
 */
export const useKbarAdminSettings = () => {
  const router = useRouter()
  const data = useUser()
  const { hasAccess } = useFeatureFlags()

  const goToSetting = (page: string) => {
    router.push(`/app/settings${page}`)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: adminSettingsActions built from stable refs
  const actions = React.useMemo(() => {
    if (!data?.isAdminOrOwner) return []

    const result: Action[] = [
      {
        id: 'goToChannelsSettings',
        name: 'Channels',
        icon: 'inbox',
        shortcut: ['s', 'i'],
        keywords: 'channels',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/channels'),
      },
      {
        id: 'goToMembersSettings',
        name: 'Members',
        icon: 'users',
        shortcut: ['s', 'm'],
        keywords: 'members, users',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/members'),
      },
      {
        id: 'goToGroupsSettings',
        name: 'Groups',
        icon: 'layers',
        shortcut: ['s', 'r'],
        keywords: 'groups, users',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/groups'),
      },
      {
        id: 'goToInboxSettings',
        name: 'Inbox',
        icon: 'inbox',
        shortcut: ['s', 'b'],
        keywords: 'inbox, messages',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/inbox'),
      },
      {
        id: 'goToAppearanceSettings',
        name: 'Appearance',
        icon: 'sun',
        shortcut: ['s', 'l'],
        keywords: 'appearance, theme',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/appearance'),
      },
      {
        id: 'goToAiModelsSettings',
        name: 'AI Models',
        icon: 'sparkles',
        shortcut: ['s', 'a'],
        keywords: 'ai, models, openai, gemini, deepseek, qwen, kimi, chatgpt, claude',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/aiModels'),
      },
      {
        id: 'goToCustomFieldsSettings',
        name: 'Custom Fields',
        icon: 'text-cursor-input',
        shortcut: ['s', 'c'],
        keywords: 'custom, fields',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/custom-fields'),
      },
      {
        id: 'goToTagsSettings',
        name: 'Tags',
        icon: 'tag',
        shortcut: ['s', 't'],
        keywords: 'tags',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/tags'),
      },
      {
        id: 'goToBillingSettings',
        name: 'Billing',
        icon: 'credit-card',
        shortcut: ['s', 'b'],
        keywords: 'billing, plans',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/plans'),
      },
      {
        id: 'goToAppsSettings',
        name: 'Apps',
        icon: 'boxes',
        shortcut: ['s', 'p'],
        keywords: 'apps, marketplace, integrations',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/apps'),
      },
    ]

    if (hasAccess('webhooks')) {
      result.push({
        id: 'goToWebhooksSettings',
        name: 'Webhooks',
        icon: 'webhook',
        shortcut: ['s', 'w'],
        keywords: 'webhooks',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/webhooks'),
      })
    }

    if (hasAccess('apiAccess')) {
      result.push({
        id: 'goToApiKeysSettings',
        name: 'API Keys Settings',
        icon: 'key',
        shortcut: ['s', 'k'],
        keywords: 'api, keys',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/apiKeys'),
      })
    }

    if (hasAccess('shopify')) {
      result.push({
        id: 'goToShopifySettings',
        name: 'Shopify',
        icon: 'shopping-cart',
        shortcut: ['s', 'h'],
        keywords: 'shopify',
        section: 'Settings',
        parent: 'goToSettings',
        perform: () => goToSetting('/shopify'),
      })
    }

    return result
  }, [data?.isAdminOrOwner, hasAccess])

  useRegisterActions(actions, [actions])
}
