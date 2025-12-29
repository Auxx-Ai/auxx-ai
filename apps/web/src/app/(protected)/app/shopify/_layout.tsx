'use client'
// import { usePathname } from 'next/navigation'
import * as React from 'react'
// import SidebarSecondary from '~/components/global/sidebar-secondary'
// import { SHOPIFY_MENU } from '~/constants/menu'

// type Prop = { children: React.ReactNode; slug: string }

export default function SettingsSidebar({ children }: { children: React.ReactNode }) {
  // const pathname = usePathname()
  // console.log(page);
  // const pages = pathname.split('/')
  // const page = pages[3]

  return (
    <div className="flex h-screen flex-1 overflow-hidden bg-neutral-100 dark:bg-background">
      <div className="position-relative flex h-full flex-1 grow overflow-y-auto">{children}</div>
    </div>
  )
}
