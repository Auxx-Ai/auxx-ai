// apps/web/src/components/global/sidebar/inbox-edit-menu-item.test.tsx

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sidebar's "Edit Inbox" gate.
 *
 * The row and the authority come from DIFFERENT places, which is the whole bug
 * this pins: `record.listAll` hands back every inbox in the org (both inbox defs
 * are exempt from instance-access routing on the READ arm), so a member whose
 * only reach into a mailbox is one shared thread still gets a sidebar row for
 * it. Rendering an edit affordance off the row's existence offers a settings
 * page the server will refuse.
 *
 * The three cases that matter, and none of them show up in a screenshot of the
 * happy path:
 *
 *  - **No admin rung ⇒ no item**, even though the row renders.
 *  - **The RecordId is minted from the inbox's OWN definition.** A personal
 *    mailbox is asked about under `personal_inbox:`; one still on the shared def
 *    during the 060 window is asked about under `inbox:`. Deriving the key from
 *    `isPersonal` would ask the wrong keyspace and hide the owner's own item.
 *  - **An inbox with no definition discriminator fails CLOSED** and is never
 *    even asked about.
 */

const h = vi.hoisted(() => ({
  admin: new Set<string>(),
  asked: [] as string[],
}))

vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({
    canAdminInstance: (recordId: string) => {
      h.asked.push(recordId)
      return h.admin.has(recordId)
    },
  }),
}))

// Radix's item throws outside a menu root; the component under test is the gate,
// not the menu chrome.
vi.mock('@auxx/ui/components/dropdown-menu', () => ({
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const { InboxEditMenuItem } = await import('./inbox-edit-menu-item')

beforeEach(() => {
  h.admin = new Set()
  h.asked = []
})

const SHARED = {
  id: 'ibx_1',
  name: 'Support',
  color: 'indigo',
  entityDefinitionKey: 'inbox' as const,
}
const PERSONAL = {
  id: 'ibx_2',
  name: 'markus@auxx.ai',
  color: 'indigo',
  isPersonal: true,
  ownerUserId: 'u_1',
  entityDefinitionKey: 'personal_inbox' as const,
}

describe('InboxEditMenuItem', () => {
  it('renders nothing for an inbox the viewer only sees because a thread was shared', () => {
    render(<InboxEditMenuItem inbox={SHARED} />)

    expect(screen.queryByText('Edit Inbox')).toBeNull()
    expect(h.asked).toEqual(['inbox:ibx_1'])
  })

  it('renders the settings link for an inbox the viewer administers', () => {
    h.admin.add('inbox:ibx_1')
    render(<InboxEditMenuItem inbox={SHARED} />)

    expect(screen.getByText('Edit Inbox').closest('a')).toHaveAttribute(
      'href',
      '/app/settings/inbox/ibx_1?tab=settings'
    )
  })

  it('asks about a personal mailbox in the personal keyspace, not the shared one', () => {
    h.admin.add('personal_inbox:ibx_2')
    render(<InboxEditMenuItem inbox={PERSONAL} />)

    expect(h.asked).toEqual(['personal_inbox:ibx_2'])
    expect(screen.getByText('Edit Inbox')).toBeTruthy()
  })

  it('asks in the SHARED keyspace for a personal mailbox still on the shared def', () => {
    // Pre-060: the def is `inbox`, so that is where its grant rows live. Keying
    // off `isPersonal` here would ask `personal_inbox:` and hide the owner's item.
    h.admin.add('inbox:ibx_3')
    render(
      <InboxEditMenuItem
        inbox={{
          id: 'ibx_3',
          name: 'legacy@auxx.ai',
          color: 'indigo',
          isPersonal: true,
          ownerUserId: 'u_1',
          entityDefinitionKey: 'inbox',
        }}
      />
    )

    expect(h.asked).toEqual(['inbox:ibx_3'])
    expect(screen.getByText('Edit Inbox')).toBeTruthy()
  })

  it('fails closed — and asks nothing — when the definition is unknown', () => {
    render(<InboxEditMenuItem inbox={{ id: 'ibx_4', name: 'Mystery', color: 'indigo' }} />)

    expect(screen.queryByText('Edit Inbox')).toBeNull()
    expect(h.asked).toEqual([])
  })
})
