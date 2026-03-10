// src/components/kbar/kbar-settings.tsx

import { type Action, useRegisterActions } from 'kbar'
import { useRouter } from 'next/navigation'
import React from 'react'
import { useUser } from '~/hooks/use-user'

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
      shortcut: ['s', 'g'],
      // shortcut: ['s'],
      section: 'Navigation',
      perform: () => goToSetting('/general'),
    },

    {
      id: 'goToGeneralSettings',
      name: 'General Settings',
      // shortcut: ['s', 'g'],
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/general'),
    },
    {
      id: 'goToOrganizationSettings',
      name: 'Organization Settings',
      shortcut: ['s', 'o'],
      keywords: 'organization',
      section: 'Settings',
      parent: 'goToSettings',

      perform: () => goToSetting('/organization'),
    },
    {
      id: 'goToSnippetsSettings',
      name: 'Snippets Settings',
      shortcut: ['s', 'n'],
      keywords: 'snippets',
      section: 'Settings',
      parent: 'goToSettings',

      perform: () => goToSetting('/snippets'),
    },
    {
      id: 'goToSignaturesSettings',
      name: 'Signatures Settings',
      shortcut: ['s', 's'],
      keywords: 'signatures',
      section: 'Settings',
      parent: 'goToSettings',

      perform: () => goToSetting('/signatures'),
    },
    {
      id: 'goToSignaturesCreate',
      name: 'Create Signature',
      shortcut: ['s', 's', 'c'],
      keywords: 'signatures',
      section: 'Signatures',
      parent: 'goToSettings',

      perform: () => goToSetting('/signatures/new'),
    },

    {
      id: 'goToApiKeysSettings',
      name: 'API Keys Settings',
      shortcut: ['s', 'k'],
      keywords: 'api, keys',
      section: 'Settings',
      parent: 'goToSettings',

      perform: () => goToSetting('/apiKeys'),
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
  /**
   * Navigates to a specific settings page.
   * @param page - The settings page path.
   */
  const goToSetting = (page: string) => {
    router.push(`/app/settings${page}`)
  }
  // Admin-only settings actions
  const adminSettingsActions: Action[] = [
    {
      id: 'goToChannelsSettings',
      name: 'Channels',
      shortcut: ['s', 'i'],
      keywords: 'channels',
      section: 'Settings',
      parent: 'goToSettings',

      perform: () => goToSetting('/channels'),
    },
    {
      id: 'goToWebhooksSettings',
      name: 'Webhooks',
      shortcut: ['s', 'w'],
      keywords: 'webhooks',
      section: 'Settings',
      parent: 'goToSettings',

      perform: () => goToSetting('/webhooks'),
    },
    {
      id: 'goToShopifySettings',
      name: 'Shopify',
      shortcut: ['s', 'h'],
      keywords: 'shopify',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/shopify'),
    },
    {
      id: 'goToMembersSettings',
      name: 'Members',
      shortcut: ['s', 'm'],
      keywords: 'members, users',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/members'),
    },
    {
      id: 'goToGroupsSettings',
      name: 'Groups',
      shortcut: ['s', 'r'],
      keywords: 'groups, users',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/groups'),
    },
    {
      id: 'goToInboxSettings',
      name: 'Inbox',
      shortcut: ['s', 'b'],
      keywords: 'inbox, messages',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/inbox'),
    },
    {
      id: 'goToAppearanceSettings',
      name: 'Appearance',
      shortcut: ['s', 'l'],
      keywords: 'appearance, theme',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/appearance'),
    },
    {
      id: 'goToAiModelsSettings',
      name: 'AI Models',
      shortcut: ['s', 'a'],
      keywords: 'ai, models, openai, gemini, deepseek, chatgpt, claude',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/aiModels'),
    },
    {
      id: 'goToCustomFieldsSettings',
      name: 'Custom Fields',
      shortcut: ['s', 'c'],
      keywords: 'custom, fields',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/custom-fields'),
    },
    {
      id: 'goToTagsSettings',
      name: 'Tags',
      shortcut: ['s', 't'],
      keywords: 'tags',
      section: 'Settings',
      parent: 'goToSettings',
      perform: () => goToSetting('/tags'),
    },
    {
      id: 'goToBillingSettings',
      name: 'Billing',
      shortcut: ['s', 'b'],
      keywords: 'billing, plans',
      section: 'Settings',
      parent: 'goToSettings',

      perform: () => goToSetting('/plans'),
    },
  ]
  // Only register actions if user is admin or owner
  // biome-ignore lint/correctness/useExhaustiveDependencies: adminSettingsActions is a static array defined inline
  const actions = React.useMemo(
    () => (data?.isAdminOrOwner ? adminSettingsActions : []),
    [data?.isAdminOrOwner]
  )
  useRegisterActions(actions, [data])
}
