// apps/web/src/app/(protected)/app/credit-memos/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Credit memos page, the shared RecordsView for the `credit-memos` resource
 * (plans/accounting/tasks/done/10-credit-memos.md §6.1). Drawer-only, like invoices:
 * there is no `[creditMemoId]/` detail route, so opening a row opens the drawer.
 *
 * The bulk credit memo posting header action is gone (accounting migration
 * step 1b): every issued memo posts as it happens now, so there is nothing
 * left to batch here. The Drafts tab (step 1c) is where a held draft gets
 * reviewed.
 */
export default function CreditMemosPage() {
  return <RecordsView slug='credit-memos' basePath='/app/credit-memos' />
}
