// apps/web/src/components/kbar/actions/navigation.ts
'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { useViewableResources } from '~/components/resources/hooks/use-viewable-resources'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { SHORTCUTS } from '../shortcuts'
import { useCommandPaletteStore } from '../store'
import type { PaletteAction } from '../types'

/**
 * Navigation actions — every top-level destination plus the inbox / shared-inbox
 * / tickets / shopify folder children. Feature-flag- and admin-gated items only
 * appear when the org has access. Chords come from {@link SHORTCUTS} (the single
 * source of truth); items not listed there have no global chord by design.
 */
export function useNavigationActions(): PaletteAction[] {
  const router = useRouter()
  const { hasAccess } = useFeatureFlags()
  const { can } = useAccess()
  // Per-def read gate for the core-record destinations, mirroring the sidebar
  // (which lists only viewable defs, #1296). Keyed by `apiSlug`.
  const { resources: viewableResources, isLoading: resourcesLoading } = useViewableResources()
  const viewableSlugs = useMemo(
    () => new Set(viewableResources.map((r) => r.apiSlug)),
    [viewableResources]
  )

  const nav = useCallback(
    (path: string) => {
      router.push(`/app${path}`)
      useCommandPaletteStore.getState().close()
    },
    [router]
  )

  return useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = []

    // View, not Manage — matches SIDEBAR_MENU. Without the capability half this
    // entry walked members straight into the landing page's /access-denied
    // redirect, because `dashboards-list-view.tsx` guards on the same key.
    if (hasAccess('dashboards') && can('dashboards.view')) {
      actions.push({
        id: 'nav.dashboards',
        label: 'Dashboards',
        subtitle: 'View your dashboards',
        icon: 'layout-dashboard',
        keywords: 'dashboards analytics reports',
        perform: () => nav('/dashboards'),
      })
    }

    if (hasAccess('todayInbox')) {
      actions.push({
        id: 'nav.today',
        label: 'Today',
        subtitle: "Today's inbox",
        icon: 'sun',
        keywords: 'today inbox',
        perform: () => nav('/today'),
      })
    }

    if (hasAccess('kopilot')) {
      actions.push({
        id: 'nav.chats',
        label: 'Chats',
        subtitle: 'Kopilot chats',
        icon: 'message-square',
        keywords: 'chats kopilot ai assistant',
        perform: () => nav('/kopilot/new'),
      })
    }

    // `agents.view` — navigation is reachability, not authoring (see the
    // `workflows.view` entry below).
    if (hasAccess('agents') && can('agents.view')) {
      actions.push({
        id: 'nav.agents',
        label: 'Agents',
        subtitle: 'Your agents',
        icon: 'brain',
        keywords: 'agents ai',
        perform: () => nav('/agents'),
      })
    }

    if (hasAccess('callRecordings')) {
      actions.push({
        id: 'nav.calls',
        label: 'Calls',
        subtitle: 'Call recordings',
        icon: 'video',
        keywords: 'calls recordings video',
        perform: () => nav('/calls'),
      })
    }

    // ── Personal inbox + children ────────────────────────────────────────
    actions.push(
      {
        id: 'nav.inbox',
        label: 'Inbox',
        subtitle: 'View your inbox',
        icon: 'inbox',
        keywords: 'inbox',
        shortcut: SHORTCUTS['nav.inbox'],
        perform: () => nav('/mail/inbox/open'),
      },
      {
        id: 'nav.inbox.done',
        label: 'Done',
        subtitle: 'Your done folder',
        icon: 'check-circle',
        keywords: 'inbox done completed',
        perform: () => nav('/mail/inbox/done'),
      },
      {
        id: 'nav.inbox.trash',
        label: 'Trash',
        subtitle: 'Your trash folder',
        icon: 'trash',
        keywords: 'inbox trash deleted',
        perform: () => nav('/mail/inbox/trash'),
      },
      {
        id: 'nav.inbox.spam',
        label: 'Spam',
        subtitle: 'Your spam folder',
        icon: 'ban',
        keywords: 'inbox spam junk',
        perform: () => nav('/mail/inbox/spam'),
      },
      {
        id: 'nav.drafts',
        label: 'Drafts',
        subtitle: 'Your drafts folder',
        icon: 'mail',
        keywords: 'inbox drafts',
        perform: () => nav('/mail/drafts'),
      },
      {
        id: 'nav.sent',
        label: 'Sent',
        subtitle: 'Your sent folder',
        icon: 'send',
        keywords: 'inbox sent',
        perform: () => nav('/mail/sent'),
      }
    )

    // ── Shared inbox + children ──────────────────────────────────────────
    actions.push(
      {
        id: 'nav.sharedInbox.unassigned',
        label: 'Shared Inbox',
        subtitle: 'Unassigned shared inbox',
        icon: 'mails',
        keywords: 'shared inbox unassigned',
        shortcut: SHORTCUTS['nav.sharedInbox.unassigned'],
        perform: () => nav('/mail/inboxes/all/unassigned'),
      },
      {
        id: 'nav.sharedInbox.assigned',
        label: 'Assigned',
        subtitle: 'Assigned shared inbox',
        icon: 'user-check',
        keywords: 'shared inbox assigned',
        shortcut: SHORTCUTS['nav.sharedInbox.assigned'],
        perform: () => nav('/mail/inboxes/all/assigned'),
      },
      {
        id: 'nav.sharedInbox.done',
        label: 'Shared Done',
        subtitle: 'Done shared inbox',
        icon: 'check-circle',
        keywords: 'shared inbox done',
        shortcut: SHORTCUTS['nav.sharedInbox.done'],
        perform: () => nav('/mail/inboxes/all/done'),
      },
      {
        id: 'nav.sharedInbox.trash',
        label: 'Shared Trash',
        subtitle: 'Trash shared inbox',
        icon: 'trash',
        keywords: 'shared inbox trash',
        shortcut: SHORTCUTS['nav.sharedInbox.trash'],
        perform: () => nav('/mail/inboxes/all/trash'),
      },
      {
        id: 'nav.sharedInbox.spam',
        label: 'Shared Spam',
        subtitle: 'Spam shared inbox',
        icon: 'ban',
        keywords: 'shared inbox spam junk',
        shortcut: SHORTCUTS['nav.sharedInbox.spam'],
        perform: () => nav('/mail/inboxes/all/spam'),
      }
    )

    // ── Records ──────────────────────────────────────────────────────────
    // Per-def view gate: show a core-record destination only when its def is
    // viewable (or while the catalog is still loading, so core nav never flickers
    // out). Keyed by `apiSlug`; mirrors the sidebar's viewable-defs filter.
    const recordVisible = (apiSlug: string) => resourcesLoading || viewableSlugs.has(apiSlug)

    if (recordVisible('contacts')) {
      actions.push({
        id: 'nav.contacts',
        label: 'Contacts',
        subtitle: 'View your contacts',
        icon: 'users',
        keywords: 'contacts people',
        shortcut: SHORTCUTS['nav.contacts'],
        perform: () => nav('/contacts'),
      })
    }
    if (recordVisible('companies')) {
      actions.push({
        id: 'nav.companies',
        label: 'Companies',
        subtitle: 'View your companies',
        icon: 'building-2',
        keywords: 'companies organizations accounts',
        shortcut: SHORTCUTS['nav.companies'],
        perform: () => nav('/companies'),
      })
    }
    if (recordVisible('parts')) {
      actions.push({
        id: 'nav.parts',
        label: 'Parts',
        subtitle: 'View your parts inventory',
        icon: 'package',
        keywords: 'parts inventory manufacturing',
        shortcut: SHORTCUTS['nav.parts'],
        perform: () => nav('/parts'),
      })
    }
    if (recordVisible('tickets')) {
      actions.push(
        {
          id: 'nav.tickets',
          label: 'Tickets',
          subtitle: 'View your tickets',
          icon: 'ticket',
          keywords: 'tickets support',
          shortcut: SHORTCUTS['nav.tickets'],
          perform: () => nav('/tickets/list'),
        },
        {
          id: 'nav.tickets.filter',
          label: 'Tickets · Filter',
          icon: 'filter',
          keywords: 'tickets filter',
          perform: () => nav('/tickets/list?filter=true'),
        },
        {
          id: 'nav.tickets.dashboard',
          label: 'Tickets · Dashboard',
          icon: 'layout-dashboard',
          keywords: 'tickets dashboard',
          perform: () => nav('/tickets/dashboard'),
        },
        {
          id: 'nav.tickets.settings',
          label: 'Tickets · Settings',
          icon: 'settings',
          keywords: 'tickets settings',
          perform: () => nav('/tickets/settings'),
        }
      )
    }
    // Tasks is a core destination with no per-area/def gate (matches the sidebar).
    actions.push({
      id: 'nav.tasks',
      label: 'Tasks',
      subtitle: 'View your tasks',
      icon: 'list-checks',
      keywords: 'tasks to-do',
      shortcut: SHORTCUTS['nav.tasks'],
      perform: () => nav('/tasks'),
    })

    // ── Feature-gated destinations ───────────────────────────────────────
    if (hasAccess('dispatch') && can('dispatch.mySchedule')) {
      actions.push({
        id: 'nav.schedule',
        label: 'Schedule',
        subtitle: 'View your schedule',
        icon: 'calendar-clock',
        keywords: 'schedule calendar dispatch appointments',
        perform: () => nav('/schedule'),
      })
    }
    // View, not Manage — matches SIDEBAR_MENU; Manage fronts creation, not reaching the list.
    if (hasAccess('workflows') && can('workflows.view')) {
      actions.push({
        id: 'nav.workflows',
        label: 'Workflows',
        subtitle: 'View your workflows',
        icon: 'git-branch',
        keywords: 'workflows automation',
        shortcut: SHORTCUTS['nav.workflows'],
        perform: () => nav('/workflows'),
      })
    }
    if (hasAccess('knowledgeBase') && can('knowledgeBase.view')) {
      actions.push({
        id: 'nav.kb',
        label: 'Knowledge Bases',
        subtitle: 'View your knowledge bases',
        icon: 'book-open',
        keywords: 'knowledge base kb',
        shortcut: SHORTCUTS['nav.kb'],
        perform: () => nav('/kb'),
      })
    }
    if (hasAccess('datasets') && can('datasets.view')) {
      actions.push({
        id: 'nav.datasets',
        label: 'Datasets',
        subtitle: 'View your datasets',
        icon: 'database',
        keywords: 'datasets data',
        shortcut: SHORTCUTS['nav.datasets'],
        perform: () => nav('/datasets'),
      })
    }
    if (hasAccess('files') && can('files.view')) {
      actions.push({
        id: 'nav.files',
        label: 'Files',
        subtitle: 'View your files',
        icon: 'folder',
        keywords: 'files documents storage',
        shortcut: SHORTCUTS['nav.files'],
        perform: () => nav('/files'),
      })
    }
    return actions
  }, [hasAccess, can, nav, viewableSlugs, resourcesLoading])
}
