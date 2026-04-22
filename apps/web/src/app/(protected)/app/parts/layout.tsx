// apps/web/src/app/(protected)/app/parts/layout.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Package, Plus } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { parseAsBoolean, useQueryState } from 'nuqs'

function PartsLayoutHeader() {
  const [, setCreateDialogOpen] = useQueryState('create', parseAsBoolean.withDefault(false))

  return (
    <MainPageHeader
      action={
        <Button size='sm' onClick={() => setCreateDialogOpen(true)}>
          <Plus />
          Create Part
          <KbdGroup variant='default' size='sm'>
            <Kbd>c</Kbd>
            <Kbd>p</Kbd>
          </KbdGroup>
        </Button>
      }>
      <MainPageBreadcrumb>
        <MainPageBreadcrumbItem
          title='Parts'
          href='/app/parts'
          icon={<Package className='size-4' />}
          last
        />
      </MainPageBreadcrumb>
    </MainPageHeader>
  )
}

export default function PartsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // Detail pages have their own MainPage wrapper via DetailView
  const isDetailPage =
    /\/parts\/[^/]+$/.test(pathname) &&
    !pathname.endsWith('/parts') &&
    !pathname.includes('/import')

  if (isDetailPage) {
    return <>{children}</>
  }

  return (
    <MainPage>
      <PartsLayoutHeader />
      {children}
    </MainPage>
  )
}
