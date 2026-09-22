// apps/web/src/components/accounting/ui/ledger/outbox-route.ts

import type { OutboxTab } from '@auxx/lib/accounting/export/client'

/**
 * The Outbox's own route, and the tab param that replaced `?queue=`
 * (81-one-accounting-shell.md §0.1). Breaking existing `?queue=` links is
 * explicitly accepted.
 *
 * 🛑 This reverses the deleted `ledger-sidebar.tsx`'s rule that the two had to
 * be BUTTONS over nuqs setters on one URL, because links "would drop the month
 * on every click". That held while the rail was ledger-only; with Banking and
 * Reports in the same rail it cannot be half links and half buttons, and the
 * month is carried by `SidebarSecondary`'s `linkQuery` instead.
 */
export const OUTBOX_ROUTE = '/app/accounting/outbox'

/** Which tab the Outbox opens on. Was `?queue=` while the outbox was a view of one URL. */
export const OUTBOX_TAB_PARAM = 'tab'

/** How a batch tab is grouped and ordered; both absent is the flat list, newest first. */
export const OUTBOX_GROUP_PARAM = 'group'
export const OUTBOX_ORDER_PARAM = 'order'

/** Summary or Transaction rows on the batch tabs; absent follows the org's export mode. */
export const OUTBOX_VIEW_PARAM = 'view'

export function outboxHref(tab?: OutboxTab): string {
  return tab ? `${OUTBOX_ROUTE}?${OUTBOX_TAB_PARAM}=${tab}` : OUTBOX_ROUTE
}
