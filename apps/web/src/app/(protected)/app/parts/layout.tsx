// apps/web/src/app/(protected)/app/parts/layout.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Calculator, Package, Plus } from 'lucide-react'
import { parseAsBoolean, useQueryState } from 'nuqs'
import { api } from '~/trpc/react'

function PartsLayoutHeader() {
  const [, setCreateDialogOpen] = useQueryState('create', parseAsBoolean.withDefault(false))

  const calculateAllCosts = api.part.calculateAllCosts.useMutation({
    onSuccess: () => toastSuccess({ title: 'Costs recalculated successfully' }),
    onError: (error) =>
      toastError({ title: 'Error recalculating costs', description: error.message }),
  })

  return (
    <MainPageHeader
      action={
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => calculateAllCosts.mutate()}
            loading={calculateAllCosts.isPending}
            loadingText='Recalculating...'>
            <Calculator />
            Recalculate Costs
          </Button>
          <Button size='sm' onClick={() => setCreateDialogOpen(true)}>
            <Plus />
            Create Part
          </Button>
        </div>
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
  return (
    <MainPage>
      <PartsLayoutHeader />
      {children}
    </MainPage>
  )
}
