// apps/web/src/app/(protected)/app/credit-memos/page.tsx
'use client'

import { PostCreditMemosButton } from '~/components/money/ui/credit-memo-posting'
import { RecordsView } from '~/components/records'

/**
 * Credit memos page, the shared RecordsView for the `credit-memos` resource
 * (plans/accounting/tasks/10-credit-memos.md §6.1). Drawer-only, like invoices:
 * there is no `[creditMemoId]/` detail route, so opening a row opens the drawer.
 *
 * The `pageActions` button is the bulk credit memo posting's entry point
 * (plans/accounting/tasks/25-batch-posting-and-credit-memos.md §9 item 14),
 * mirroring the orders page's `PostFulfillmentsButton`: one header action beside
 * Create, no extra row above the table. It renders nothing without `ledger.post`.
 */
export default function CreditMemosPage() {
  return (
    <RecordsView
      slug='credit-memos'
      basePath='/app/credit-memos'
      pageActions={<PostCreditMemosButton />}
    />
  )
}
