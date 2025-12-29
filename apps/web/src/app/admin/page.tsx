// apps/web/src/app/admin/page.tsx

import { redirect } from 'next/navigation'

/**
 * Admin dashboard page - redirects to organizations for now
 */
export default function AdminDashboardPage() {
  redirect('/admin/organizations')
}
