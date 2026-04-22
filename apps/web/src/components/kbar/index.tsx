'use client'
import {
  type Action,
  KBarAnimator,
  KBarPortal,
  KBarPositioner,
  KBarProvider,
  KBarSearch,
} from 'kbar'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useComposeStore } from '~/components/mail/store/compose-store'
import { useCreateTaskStore } from '~/components/tasks/stores/create-task-store'
import useKbarSettings, { useKbarAdminSettings } from './kbar-settings'
import RenderResults from './render-results'
import { useEntityCreateActions } from './use-entity-create-actions'
import useFeatureGatedActions from './use-feature-gated-actions'
import useThemeSwitching from './use-theme-switching'

type Props = { children: React.ReactNode }

export default function KBar({ children }: Props) {
  const router = useRouter()

  const goTo = (page: string) => {
    router.push(`/app/${page}`)
  }

  const actions: Action[] = [
    {
      id: 'compose',
      name: 'Compose',
      subtitle: 'Write a new message',
      icon: 'edit',
      keywords: 'compose, write, new, email, message',
      section: 'Actions',
      perform: () => useComposeStore.getState().open({ mode: 'new', displayMode: 'floating' }),
    },
    {
      id: 'createTask',
      name: 'Create Task',
      subtitle: 'Create a new task',
      icon: 'list-checks',
      keywords: 'task, create, new, to-do',
      section: 'Actions',
      perform: () => useCreateTaskStore.getState().openDialog(),
    },
    {
      id: 'goToInbox',
      name: 'Inbox',
      subtitle: 'View your inbox',
      keywords: 'inbox',
      icon: 'inbox',
      shortcut: ['g', 'i'],
      section: 'Navigation',
      perform: () => goTo('/mail/inbox/open'),
    },
    {
      id: 'goToInboxDone',
      name: 'Done',
      subtitle: 'View your personal done folder',
      icon: 'check-circle',
      keywords: 'inbox, done, completed',
      shortcut: ['g', 'i', 'd'],
      parent: 'goToInbox',
      section: 'Inbox',
      perform: () => goTo('/mail/inbox/done'),
    },
    {
      id: 'goToInboxTrash',
      name: 'Trash',
      subtitle: 'View your personal trash folder',
      icon: 'trash',
      keywords: 'inbox, trash, deleted',
      shortcut: ['g', 'i', 't'],
      parent: 'goToInbox',
      section: 'Inbox',
      perform: () => goTo('/mail/inbox/trash'),
    },
    {
      id: 'goToInboxSpam',
      name: 'Spam',
      subtitle: 'View your personal spam folder',
      icon: 'ban',
      keywords: 'inbox, spam, personal, junk',
      shortcut: ['g', 'i', 'j'],
      parent: 'goToInbox',
      section: 'Inbox',
      perform: () => goTo('/mail/inbox/spam'),
    },
    {
      id: 'goToDrafts',
      name: 'Drafts',
      subtitle: 'View your drafts folder',
      icon: 'mail',
      keywords: 'inbox, drafts',
      shortcut: ['g', 'i', 'r'],
      parent: 'goToInbox',
      section: 'Inbox',
      perform: () => goTo('/mail/drafts'),
    },
    {
      id: 'goToSent',
      name: 'Sent',
      subtitle: 'View your sent folder',
      icon: 'send',
      keywords: 'inbox, sent',
      shortcut: ['g', 'i', 's'],
      parent: 'goToInbox',
      section: 'Inbox',
      perform: () => goTo('/mail/sent'),
    },

    {
      id: 'goToSharedInbox',
      name: 'Shared Inbox',
      subtitle: 'View shared inbox folder',
      icon: 'mails',
      keywords: 'shared, inbox, unassigned',
      shortcut: ['g', 's', 'u'],
      section: 'Navigation',
      perform: () => goTo('/mail/inboxes/all/unassigned'),
    },
    {
      id: 'goToSharedInboxAssigned',
      name: 'Assigned',
      subtitle: 'View assigned shared inbox folder',
      icon: 'user-check',
      keywords: 'shared, inbox, assigned',
      shortcut: ['g', 's', 'a'],
      section: 'Shared Inbox',
      parent: 'goToSharedInbox',
      perform: () => goTo('/mail/inboxes/all/assigned'),
    },
    {
      id: 'goToSharedInboxDone',
      name: 'Done',
      subtitle: 'View done shared inbox folder',
      icon: 'check-circle',
      keywords: 'shared, inbox, done',
      shortcut: ['g', 's', 'd'],
      section: 'Shared Inbox',
      parent: 'goToSharedInbox',
      perform: () => goTo('/mail/inboxes/all/done'),
    },
    {
      id: 'goToSharedInboxTrash',
      name: 'Trash',
      subtitle: 'View trash shared inbox folder',
      icon: 'trash',
      keywords: 'shared, inbox, trash',
      shortcut: ['g', 's', 't'],
      section: 'Shared Inbox',
      parent: 'goToSharedInbox',
      perform: () => goTo('/mail/inboxes/all/trash'),
    },
    {
      id: 'goToSharedInboxSpam',
      name: 'Spam',
      subtitle: 'View spam shared inbox folder',
      icon: 'ban',
      keywords: 'shared, inbox, spam, junk',
      shortcut: ['g', 's', 'p'],
      section: 'Shared Inbox',
      parent: 'goToSharedInbox',
      perform: () => goTo('/mail/inboxes/all/spam'),
    },
    {
      id: 'goToContacts',
      name: 'Contacts',
      subtitle: 'View your contacts',
      icon: 'users',
      shortcut: ['g', 'c'],
      keywords: 'contacts',
      section: 'Navigation',
      perform: () => goTo('/contacts'),
    },

    {
      id: 'goToParts',
      name: 'Parts',
      subtitle: 'View your parts inventory',
      icon: 'package',
      shortcut: ['g', 'p'],
      keywords: 'parts, inventory, manufacturing',
      section: 'Navigation',
      perform: () => goTo('/parts'),
    },

    {
      id: 'goToTickets',
      name: 'Tickets',
      subtitle: 'View your tickets',
      icon: 'ticket',
      shortcut: ['g', 't'],
      keywords: 'tickets',
      section: 'Navigation',
      perform: () => goTo('/tickets/list'),
    },
    {
      id: 'goToTicketsListFilter',
      name: 'Filter',
      icon: 'filter',
      shortcut: ['t', 'f'],
      keywords: 'tickets',
      section: 'Tickets',
      parent: 'goToTickets',
      perform: () => goTo('/tickets/list?filter=true'),
    },

    {
      id: 'goToTicketsSettings',
      name: 'Settings',
      icon: 'settings',
      shortcut: ['t', 's'],
      keywords: 'tickets, settings',
      section: 'Tickets',
      parent: 'goToTickets',
      perform: () => goTo('/tickets/settings'),
    },

    {
      id: 'goToTicketsDashboard',
      name: 'Dashboard',
      icon: 'layout-dashboard',
      shortcut: ['t', 'd'],
      keywords: 'tickets, dashboard',
      parent: 'goToTickets',
      section: 'Tickets',
      perform: () => goTo('/tickets/dashboard'),
    },
    {
      id: 'goToTasks',
      name: 'Tasks',
      subtitle: 'View your tasks',
      icon: 'list-checks',
      shortcut: ['g', 'a'],
      keywords: 'tasks, to-do',
      section: 'Navigation',
      perform: () => goTo('/tasks'),
    },
  ]
  return (
    <KBarProvider actions={actions}>
      <ActualComponent>{children}</ActualComponent>
    </KBarProvider>
  )
}
const ActualComponent = ({ children }: Props) => {
  useThemeSwitching()
  useKbarSettings()
  useKbarAdminSettings()
  useFeatureGatedActions()
  useEntityCreateActions()

  return (
    <>
      <KBarPortal>
        <KBarPositioner className='scrollbar-hide fixed inset-0 z-99999 backdrop-blur-sm transition-all duration-100 p-0!'>
          <KBarAnimator className='relative mt-64! w-full max-w-[600px] -translate-y-12! overflow-hidden rounded-2xl border border-border/50 bg-background text-popover-foreground shadow-lg dark:border-[#323842]/80'>
            <div className='bg-background pb-2'>
              <div className='border-x-0 border-b border-border/50 dark:border-[#323842]/80'>
                <KBarSearch className='w-full border-none bg-transparent px-3 py-3 text-sm outline-hidden focus:outline-hidden focus:ring-0 focus:ring-offset-0 placeholder:text-muted-foreground' />
              </div>
              <RenderResults />
            </div>
          </KBarAnimator>
        </KBarPositioner>
      </KBarPortal>
      {children}
    </>
  )
}
