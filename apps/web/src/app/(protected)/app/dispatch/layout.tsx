// apps/web/src/app/(protected)/app/dispatch/layout.tsx

'use client'

import { MainPage } from '@auxx/ui/components/main-page'

/**
 * Minimal module shell for `/app/dispatch/*` — MQ1 only ships the settings
 * scaffold (§H.5), so this just provides the `MainPage` chrome that
 * `dispatch/settings/layout.tsx` (and its `MainPageContent`) expect from an
 * ancestor, mirroring `tickets/layout.tsx`. M2's dispatch board replaces this
 * with the real module header (tab switcher, create action, etc.).
 */
export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  return <MainPage>{children}</MainPage>
}
