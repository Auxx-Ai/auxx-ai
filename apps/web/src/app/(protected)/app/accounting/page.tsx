// apps/web/src/app/(protected)/app/accounting/page.tsx

import { redirect } from 'next/navigation'

/**
 * The module root, forwarding to Closeout (81-one-accounting-shell.md §0.2).
 *
 * 🛑 This REVERSES the previous rule that `/app/accounting` "renders, never
 * redirects" for the sake of bookmarkability: a redirect forwards a bookmark
 * rather than breaking it, and `reports/page.tsx` and `settings/page.tsx` both
 * already redirect. Closeout had to become a real segment so every rail row
 * could be a plain link off one `baseUrl`, and a root that renders the month
 * would have made the rail half links and half buttons.
 */
function AccountingHome() {
  redirect('/app/accounting/closeout')
}

export default AccountingHome
