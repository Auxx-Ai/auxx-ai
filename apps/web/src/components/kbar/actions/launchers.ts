// apps/web/src/components/kbar/actions/launchers.ts
'use client'

import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useCommandPaletteStore } from '../store'
import type { PaletteAction } from '../types'

/**
 * "Create …" actions for flows that live in standalone dialogs elsewhere. Their
 * forms are shell-free cores (see e.g. `webhook-form.tsx`), so the palette hosts
 * them as embedded pages with full back-nav — the action just drills into the
 * matching `create-*` page. Team invite has no form core (its Card form is
 * page-coupled), so it routes to the members page instead.
 *
 * Every action is gated to match where the feature is reachable today (the same
 * flag/admin checks the sidebar + settings menu use); an action for a disabled
 * feature or a non-admin must not appear.
 */
export function useLauncherActions(): PaletteAction[] {
  const router = useRouter()
  const { hasAccess } = useFeatureFlags()
  const { isAdminOrOwner } = useUser()

  return useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = []

    if (hasAccess('apiAccess')) {
      actions.push({
        id: 'create.apiKey',
        label: 'Create API Key',
        subtitle: 'New API secret key',
        icon: 'key',
        keywords: 'create new api key secret token',
        perform: () => useCommandPaletteStore.getState().openCreateApiKey(),
      })
    }

    if (isAdminOrOwner && hasAccess('webhooks')) {
      actions.push({
        id: 'create.webhook',
        label: 'Create Webhook',
        subtitle: 'New outgoing webhook',
        icon: 'webhook',
        keywords: 'create new webhook endpoint event',
        perform: () => useCommandPaletteStore.getState().openCreateWebhook(),
      })
    }

    if (isAdminOrOwner) {
      actions.push({
        id: 'create.inbox',
        label: 'Create Inbox',
        subtitle: 'New shared inbox',
        icon: 'inbox',
        keywords: 'create new inbox shared mailbox',
        perform: () => useCommandPaletteStore.getState().openCreateInbox(),
      })
    }

    actions.push({
      id: 'create.mailView',
      label: 'Create Mail View',
      subtitle: 'New saved mail view',
      icon: 'filter',
      keywords: 'create new mail view saved filter',
      perform: () => useCommandPaletteStore.getState().openCreateMailView(),
    })

    if (hasAccess('callRecordings')) {
      actions.push({
        id: 'create.meeting',
        label: 'Create Meeting',
        subtitle: 'Schedule a recorded meeting',
        icon: 'video',
        keywords: 'create new meeting call recording schedule',
        perform: () => useCommandPaletteStore.getState().openCreateMeeting(),
      })
    }

    if (isAdminOrOwner) {
      actions.push({
        id: 'create.group',
        label: 'Create Group',
        subtitle: 'New member group',
        icon: 'layers',
        keywords: 'create new group team members',
        perform: () => useCommandPaletteStore.getState().openCreateGroup(),
      })
    }

    if (hasAccess('datasets')) {
      actions.push({
        id: 'create.dataset',
        label: 'Create Dataset',
        subtitle: 'New vector dataset',
        icon: 'database',
        keywords: 'create new dataset embeddings vector',
        perform: () => useCommandPaletteStore.getState().openCreateDataset(),
      })
    }

    // Team invite has no shell-free form core — its invite form is a page-coupled
    // Card (requires org context, routes on cancel). Route to the members page.
    if (isAdminOrOwner && hasAccess('teammates')) {
      actions.push({
        id: 'create.invite',
        label: 'Invite Teammate',
        subtitle: 'Invite a member to your organization',
        icon: 'user-plus',
        keywords: 'invite teammate member user organization',
        perform: () => {
          router.push('/app/settings/members')
          useCommandPaletteStore.getState().close()
        },
      })
    }

    return actions
  }, [hasAccess, isAdminOrOwner, router])
}
