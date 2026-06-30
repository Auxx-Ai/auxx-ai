// apps/web/src/components/kbar/actions/settings.ts
'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { SHORTCUTS } from '../shortcuts'
import { useCommandPaletteStore } from '../store'
import type { PaletteAction } from '../types'

/**
 * Settings navigation actions, mirroring `SETTINGS_MENU`. Member-visible items
 * are always present; admin-only items appear for admins/owners; a few ride
 * feature flags. Billing keeps no chord (it lost `s,b` to Inbox settings) but
 * stays reachable via search.
 */
export function useSettingsActions(): PaletteAction[] {
  const router = useRouter()
  const { hasAccess } = useFeatureFlags()
  const { isAdminOrOwner } = useUser()
  const selfHosted = useIsSelfHosted()

  const goToSetting = useCallback(
    (slug: string) => {
      router.push(`/app/settings/${slug}`)
      useCommandPaletteStore.getState().close()
    },
    [router]
  )

  return useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = [
      {
        id: 'settings.general',
        label: 'General Settings',
        icon: 'settings',
        keywords: 'settings general',
        shortcut: SHORTCUTS['settings.general'],
        perform: () => goToSetting('general'),
      },
      {
        id: 'settings.account',
        label: 'My Account',
        icon: 'circle-user',
        keywords: 'account profile me',
        shortcut: SHORTCUTS['settings.account'],
        perform: () => goToSetting('account'),
      },
      {
        id: 'settings.organization',
        label: 'Organization Settings',
        icon: 'building',
        keywords: 'organization',
        shortcut: SHORTCUTS['settings.organization'],
        perform: () => goToSetting('organization'),
      },
      {
        id: 'settings.snippets',
        label: 'Snippets Settings',
        icon: 'braces',
        keywords: 'snippets',
        shortcut: SHORTCUTS['settings.snippets'],
        perform: () => goToSetting('snippets'),
      },
      {
        id: 'settings.signatures',
        label: 'Signatures Settings',
        icon: 'pen-tool',
        keywords: 'signatures',
        shortcut: SHORTCUTS['settings.signatures'],
        perform: () => goToSetting('signatures'),
      },
      {
        id: 'settings.apps',
        label: 'Apps & MCP',
        icon: 'boxes',
        keywords: 'apps mcp marketplace integrations',
        shortcut: SHORTCUTS['settings.apps'],
        perform: () => goToSetting('apps'),
      },
    ]

    if (hasAccess('apiAccess')) {
      actions.push({
        id: 'settings.apiKeys',
        label: 'API Keys Settings',
        icon: 'key',
        keywords: 'api keys',
        shortcut: SHORTCUTS['settings.apiKeys'],
        perform: () => goToSetting('apiKeys'),
      })
    }

    if (isAdminOrOwner) {
      actions.push(
        {
          id: 'settings.channels',
          label: 'Channels',
          icon: 'inbox',
          keywords: 'channels',
          shortcut: SHORTCUTS['settings.channels'],
          perform: () => goToSetting('channels'),
        },
        {
          id: 'settings.members',
          label: 'Members',
          icon: 'users',
          keywords: 'members users',
          shortcut: SHORTCUTS['settings.members'],
          perform: () => goToSetting('members'),
        },
        {
          id: 'settings.groups',
          label: 'Groups',
          icon: 'layers',
          keywords: 'groups teams',
          shortcut: SHORTCUTS['settings.groups'],
          perform: () => goToSetting('groups'),
        },
        {
          id: 'settings.inbox',
          label: 'Inboxes',
          icon: 'inbox',
          keywords: 'inbox inboxes messages',
          shortcut: SHORTCUTS['settings.inbox'],
          perform: () => goToSetting('inbox'),
        },
        {
          id: 'settings.aiModels',
          label: 'AI Models',
          icon: 'sparkles',
          keywords: 'ai models openai gemini deepseek claude chatgpt',
          shortcut: SHORTCUTS['settings.aiModels'],
          perform: () => goToSetting('aiModels'),
        },
        {
          id: 'settings.kopilot',
          label: 'Kopilot Settings',
          icon: 'sparkles',
          keywords: 'kopilot ai assistant',
          perform: () => goToSetting('kopilot'),
        },
        {
          id: 'settings.customFields',
          label: 'Custom Entities & Fields',
          icon: 'text-cursor-input',
          keywords: 'custom fields entities',
          shortcut: SHORTCUTS['settings.customFields'],
          perform: () => goToSetting('custom-fields'),
        },
        {
          id: 'settings.activityLog',
          label: 'Account Activity',
          icon: 'history',
          keywords: 'activity log audit history',
          perform: () => goToSetting('activity-log'),
        },
        {
          id: 'settings.tags',
          label: 'Tags',
          icon: 'tag',
          keywords: 'tags',
          shortcut: SHORTCUTS['settings.tags'],
          perform: () => goToSetting('tags'),
        },
        {
          id: 'settings.importHistory',
          label: 'Import History',
          icon: 'download',
          keywords: 'import history',
          perform: () => goToSetting('import-history'),
        }
      )

      if (hasAccess('webhooks')) {
        actions.push({
          id: 'settings.webhooks',
          label: 'Webhooks',
          icon: 'webhook',
          keywords: 'webhooks',
          shortcut: SHORTCUTS['settings.webhooks'],
          perform: () => goToSetting('webhooks'),
        })
      }
      // Billing is cloud-only and lost its `s,b` chord to Inbox settings.
      if (!selfHosted) {
        actions.push({
          id: 'settings.billing',
          label: 'Plans & Billing',
          icon: 'credit-card',
          keywords: 'billing plans subscription payment',
          perform: () => goToSetting('plans'),
        })
      }
    }

    return actions
  }, [hasAccess, isAdminOrOwner, selfHosted, goToSetting])
}
