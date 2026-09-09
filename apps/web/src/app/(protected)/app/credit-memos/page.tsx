// apps/web/src/app/(protected)/app/credit-memos/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Credit memos page, the shared RecordsView for the `credit-memos` resource
 * (plans/accounting/tasks/10-credit-memos.md §6.1). Drawer-only, like invoices:
 * there is no `[creditMemoId]/` detail route, so opening a row opens the drawer.
 */
export default function CreditMemosPage() {
  return <RecordsView slug='credit-memos' basePath='/app/credit-memos' />
}
