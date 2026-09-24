// apps/web/src/app/(protected)/app/accounting/page.tsx

import { redirect } from 'next/navigation'

interface AccountingHomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * The module root, forwarding to Closeout (81-one-accounting-shell.md §0.2). Keeps the query so
 * `/app/accounting?setup=wizard` still reaches the wizard gate on the page it lands on.
 */
async function AccountingHome({ searchParams }: AccountingHomeProps) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, item)
    }
  }
  const search = query.toString()
  redirect(search ? `/app/accounting/closeout?${search}` : '/app/accounting/closeout')
}

export default AccountingHome
