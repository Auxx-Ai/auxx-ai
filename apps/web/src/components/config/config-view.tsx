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
import { Search, X } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
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

  /** Dock state */
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

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

  /** Docked panel content */
  const dockedPanel =
    isDocked && isDrawerOpen ? (
      <ConfigDrawer
        variableKey={selectedKey}
        open={isDrawerOpen}
        onOpenChange={handleDrawerOpenChange}
        isDbEnabled={isDbEnabled}
      />
    ) : undefined

  return (
    <>
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Config' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent
          dockedPanel={dockedPanel}
          dockedPanelWidth={dockedWidth}
          onDockedPanelWidthChange={setDockedWidth}
          dockedPanelMinWidth={minWidth}
          dockedPanelMaxWidth={maxWidth}>
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

      {/* Detail drawer - overlay mode only (docked mode handled by dockedPanel above) */}
      {!isDocked && (
        <ConfigDrawer
          variableKey={selectedKey}
          open={isDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
          isDbEnabled={isDbEnabled}
        />
      )}
    </>
  )
}
