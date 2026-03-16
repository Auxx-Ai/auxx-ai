'use client'
import {
  type Action,
  KBarAnimator,
  KBarPortal,
  KBarPositioner,
  KBarProvider,
  KBarSearch,
} from 'kbar'
import { InboxIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type React from 'react'
import useKbarSettings, { useKbarAdminSettings } from './kbar-settings'
import RenderResults from './render-results'
import useThemeSwitching from './use-theme-switching'

// import { useTheme } from 'next-themes'

type Props = { children: React.ReactNode }

export default function KBar({ children }: Props) {
  const router = useRouter()

  const goTo = (page: string) => {
    router.push(`/app/${page}`)
  }

  const actions: Action[] = [
    {
      id: 'goToInbox',
      name: 'Inbox',
      subtitle: 'View your inbox',
      keywords: 'inbox',
      icon: <InboxIcon />,
      shortcut: ['g', 'i'],
      section: 'Navigation',
      perform: () => goTo('/mail/inbox/open'),
    },
    {
      id: 'goToInboxDone',
      name: 'Done',
      subtitle: 'View your personal done folder',
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
      keywords: 'shared, inbox, unassigned',
      shortcut: ['g', 's', 'u'],
      section: 'Navigation',
      perform: () => goTo('/mail/inboxes/all/unassigned'),
    },
    {
      id: 'goToSharedInboxAssigned',
      name: 'Assigned',
      subtitle: 'View assigned shared inbox folder',
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
      keywords: 'shared, inbox, spam, junk',
      shortcut: ['g', 's', 'p'],
      section: 'Shared Inbox',
      parent: 'goToSharedInbox',
      perform: () => goTo('/mail/inboxes/all/spam'),
    },
    {
      id: 'goToWorkflows',
      name: 'Workflows',
      subtitle: 'View your workflows',
      shortcut: ['g', 'w'],
      keywords: 'workflows',
      section: 'Navigation',
      perform: () => goTo('/workflows'),
    },
    {
      id: 'goToContacts',
      name: 'Contacts',
      subtitle: 'View your contacts',
      shortcut: ['g', 'c'],
      keywords: 'contacts',
      section: 'Navigation',
      perform: () => goTo('/contacts'),
    },
    {
      id: 'goToContactsCreate',
      name: 'Create Contact',
      subtitle: 'Create a new contact',
      shortcut: ['c', 'c'],
      keywords: 'contacts, create, customer',
      section: 'Contacts',
      parent: 'goToContacts',
      perform: () => goTo('/contacts?create=true'),
    },

    {
      id: 'goToParts',
      name: 'Parts',
      subtitle: 'View your parts inventory',
      shortcut: ['g', 'p'],
      keywords: 'parts, inventory, manufacturing',
      section: 'Navigation',
      perform: () => goTo('/parts'),
    },
    {
      id: 'goToPartsCreate',
      name: 'Create Part',
      subtitle: 'Create a new part',
      shortcut: ['p', 'c'],
      keywords: 'parts, create',
      section: 'Parts',
      parent: 'goToParts',
      perform: () => goTo('/parts?create=true'),
    },

    {
      id: 'goToShopify',
      name: 'Shopify',
      subtitle: 'View your Shopify customers',
      shortcut: ['g', 's'],
      keywords: 'shopify, customers',
      section: 'Navigation',
      // parent: 'goToSettings',

      perform: () => goTo('/shopify/customers'),
    },
    {
      id: 'goToShopifyCustomers',
      name: 'Customers',
      subtitle: 'View your Shopify customers',
      shortcut: ['g', 's', 'c'],
      keywords: 'shopify, customers',
      section: 'Shopify',
      parent: 'goToShopify',
      perform: () => goTo('/shopify/customers'),
    },
    {
      id: 'goToShopifyOrders',
      name: 'Orders',
      subtitle: 'View your Shopify orders',
      shortcut: ['g', 's', 'o'],
      keywords: 'shopify, orders',
      section: 'Shopify',
      parent: 'goToShopify',

      perform: () => goTo('/shopify/orders'),
    },
    {
      id: 'goToShopifyProducts',
      name: 'Products',
      subtitle: 'View your Shopify products',
      shortcut: ['g', 's', 'p'],
      keywords: 'shopify, products',
      section: 'Shopify',
      parent: 'goToShopify',

      // parent: 'goToSettings',
      perform: () => goTo('/shopify/products'),
    },

    // {
    //   id: 'inboxAction',
    //   name: 'Inbox',
    //   shortcut: ['g', 'i'],
    //   keywords: 'inbox',
    //   section: 'Navigation',
    //   subtitle: 'View your inbox',
    //   perform: () => {
    //     setTab('inbox')
    //   },
    // },
    // {
    //   id: 'draftsAction',
    //   name: 'Drafts',
    //   shortcut: ['g', 'r'],
    //   keywords: 'drafts',
    //   priority: Priority.HIGH,
    //   subtitle: 'View your drafts',
    //   section: 'Navigation',
    //   perform: () => {
    //     setTab('drafts')
    //   },
    // },
    // {
    //   id: 'sentAction',
    //   name: 'Sent',
    //   shortcut: ['g', 's'],
    //   keywords: 'sent',
    //   section: 'Navigation',
    //   subtitle: 'View the sent',
    //   perform: () => {
    //     setTab('sent')
    //   },
    // },
    // {
    //   id: 'pendingAction',
    //   name: 'See done',
    //   shortcut: ['g', 'd'],
    //   keywords: 'done',
    //   section: 'Navigation',
    //   subtitle: 'View the done emails',
    //   perform: () => {
    //     setDone(true)
    //   },
    // },
    // {
    //   id: 'doneAction',
    //   name: 'See Pending',
    //   shortcut: ['g', 'u'],
    //   keywords: 'pending, undone, not done',
    //   section: 'Navigation',
    //   subtitle: 'View the pending emails',
    //   perform: () => {
    //     setDone(false)
    //   },
    // },
    {
      id: 'goToTickets',
      name: 'Tickets',
      subtitle: 'View your tickets',
      shortcut: ['g', 't'],
      keywords: 'tickets',
      section: 'Navigation',
      // parent: 'goToSettings',
      perform: () => goTo('/tickets/list'),
    },
    {
      id: 'goToTicketsListFilter',
      name: 'Filter',
      shortcut: ['t', 'f'],
      keywords: 'tickets',
      section: 'Tickets',
      parent: 'goToTickets',
      perform: () => goTo('/tickets/list?filter=true'),
    },
    {
      id: 'goToTicketsCreate',
      name: 'Create',
      shortcut: ['t', 'c'],
      keywords: 'tickets, create',
      section: 'Tickets',
      parent: 'goToTickets',
      perform: () => goTo('/tickets/list?create=true'),
    },

    {
      id: 'goToTicketsSettings',
      name: 'Settings',
      shortcut: ['t', 's'],
      keywords: 'tickets, settings',
      section: 'Tickets',
      parent: 'goToTickets',

      perform: () => goTo('/tickets/settings'),
    },

    {
      id: 'goToTicketsDashboard',
      name: 'Dashboard',
      shortcut: ['t', 'd'],
      keywords: 'tickets, dashboard',
      parent: 'goToTickets',
      section: 'Tickets',
      // parent: 'goToSettings',

      perform: () => goTo('/tickets/dashboard'),
    },
    {
      id: 'goToKnowledgeBase',
      name: 'Knowledge Bases',
      subtitle: 'View your knowledge bases',
      shortcut: ['g', 'k'],
      keywords: 'knowledge, base',
      section: 'Navigation',
      // parent: 'goToSettings',
      perform: () => goTo('/kb'),
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

  return (
    <>
      <KBarPortal>
        <KBarPositioner className='scrollbar-hide fixed inset-0 z-99999 backdrop-blur-sm transition-all duration-100 p-0!'>
          <KBarAnimator className='relative mt-64! w-full max-w-[600px] -translate-y-12! overflow-hidden rounded-lg border bg-white text-foreground shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'>
            <div className='bg-white dark:bg-gray-800'>
              <div className='border-x-0 border-b-2 dark:border-gray-700'>
                <KBarSearch className='w-full border-none bg-white px-3 py-3 text-base outline-hidden focus:outline-hidden focus:ring-0 focus:ring-offset-0 dark:bg-gray-800' />
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
