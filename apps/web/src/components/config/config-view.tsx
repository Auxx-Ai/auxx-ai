// apps/web/src/components/config/config-view.tsx
'use client'

import type { ResolvedConfigVariable } from '@auxx/credentials/config/client'
import { ConfigVariableGroupValues } from '@auxx/types/config'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
  MainPageSubheader,
} from '@auxx/ui/components/main-page'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { Search, X } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useConfirm } from '~/hooks/use-confirm'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { api } from '~/trpc/react'
import { ConfigDrawer } from './config-drawer'
import { useConfigStore } from './store/config-store'
import { ConfigTable } from './ui/config-table'

/**
 * Main config variables view.
 * Shows filters in subheader, grouped table, and detail drawer.
 */
export function ConfigView() {
  const { data: groups, isLoading } = api.configVariable.getGrouped.useQuery()
  const { data: status } = api.configVariable.getStatus.useQuery()

  const [confirm, ConfirmDialog] = useConfirm()

  /** Filter state from store */
  const search = useConfigStore((state) => state.search)
  const setSearch = useConfigStore((state) => state.setSearch)
  const groupFilter = useConfigStore((state) => state.groupFilter)
  const setGroupFilter = useConfigStore((state) => state.setGroupFilter)
  const resetFilters = useConfigStore((state) => state.resetFilters)

  const hasFilters = search || groupFilter !== null

  /** Drawer state - synced to URL via ?key= param */
  const [selectedKey, setSelectedKey] = useQueryState('key', parseAsString.withDefault(''))
  const isDrawerOpen = !!selectedKey

  /** Open drawer for a variable */
  const handleRowClick = (variable: ResolvedConfigVariable) => {
    setSelectedKey(variable.definition.key)
  }

  /** Close drawer */
  const handleDrawerOpenChange = (open: boolean) => {
    if (!open) setSelectedKey(null)
  }

  const isDbEnabled = status?.isDbEnabled ?? false

  /**
   * Re-bake the platform `ConnectionDefinition` rows from the current config.
   *
   * Lives on THIS page because this is where someone stands after rotating a
   * platform OAuth client: the rows bake an encrypted copy of the client id and
   * secret at seed time, so changing the value — here or in the environment — is
   * inert until something re-runs the seed. Before this button that something was
   * a one-line data migration and a full release.
   */
  const reseedProviders = api.admin.reseedConnectionProviders.useMutation({
    onError: (error) => toastError({ title: 'Reseed failed to start', description: error.message }),
  })

  const handleReseedProviders = async () => {
    const confirmed = await confirm({
      title: 'Reseed connection providers?',
      description:
        'Re-writes the built-in connection definitions from the deployed catalog and the ' +
        'current config, including the encrypted platform OAuth client id and secret. ' +
        'Idempotent — existing connections keep working.',
      confirmText: 'Reseed',
      cancelText: 'Cancel',
    })
    if (confirmed) reseedProviders.mutate()
  }

  const { dockedPanels, overlays } = useDockedPanels([
    {
      key: 'config-detail',
      open: isDrawerOpen,
      content: (
        <ConfigDrawer
          variableKey={selectedKey}
          open={isDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
          isDbEnabled={isDbEnabled}
        />
      ),
    },
  ])

  return (
    <>
      <ConfirmDialog />
      <MainPage>
        <MainPageHeader
          action={
            <Button
              variant='outline'
              size='sm'
              loading={reseedProviders.isPending}
              loadingText='Reseeding...'
              onClick={handleReseedProviders}>
              Reseed connection providers
            </Button>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Config' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent dockedPanels={dockedPanels}>
          {/* Filters */}
          <MainPageSubheader>
            <Select
              value={groupFilter ?? 'ALL'}
              onValueChange={(val) => setGroupFilter(val === 'ALL' ? null : (val as any))}>
              <SelectTrigger className='w-[160px]' size='sm'>
                <SelectValue placeholder='All Groups' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='ALL'>All Groups</SelectItem>
                {ConfigVariableGroupValues.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button variant='ghost' size='sm' onClick={resetFilters}>
                <X /> Clear
              </Button>
            )}

            <div className='relative flex-1 max-w-sm'>
              <Search className='absolute left-2 top-1.5 h-4 w-4 text-muted-foreground' />
              <Input
                placeholder='Search variables...'
                value={search}
                size='sm'
                onChange={(e) => setSearch(e.target.value)}
                className='pl-8'
              />
            </div>

            {!isDbEnabled && (
              <span className='text-sm text-amber-600 ml-auto'>
                DB overrides disabled — read-only
              </span>
            )}
          </MainPageSubheader>

          {/* Table */}
          <ConfigTable groups={groups ?? []} isLoading={isLoading} onRowClick={handleRowClick} />
        </MainPageContent>
      </MainPage>

      {overlays}
    </>
  )
}
