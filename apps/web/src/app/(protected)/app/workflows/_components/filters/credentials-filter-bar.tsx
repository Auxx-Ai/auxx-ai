// apps/web/src/app/(protected)/app/workflows/_components/filters/credentials-filter-bar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { LayoutGrid, List } from 'lucide-react'
import { useState } from 'react'
import { CreateCredentialDialog } from '~/components/workflow/credentials/create-credential-dialog'
import { CREDENTIAL_REGISTRY } from '~/components/workflow/credentials/credential-registry'
import { useCredentials } from '~/components/workflow/credentials/credentials-provider'

type ViewMode = 'grid' | 'table'

/**
 * Credentials filter bar component
 */
export function CredentialsFilterBar() {
  const { searchQuery, setSearchQuery, selectedType, setSelectedType, viewMode, setViewMode } =
    useCredentials()

  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  return (
    <>
      <div className='flex items-center gap-3 p-2 border-b bg-background'>
        <div className='flex flex-1 items-center gap-3'>
          {/* Search */}
          <InputSearch
            placeholder='Search credentials...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='min-w-50'
          />
        </div>

        <div className='flex items-center gap-3'>
          {/* Type Filter */}

          <div className='hidden sm:flex items-center gap-2'>
            <Select
              value={selectedType || 'all'}
              onValueChange={(value) => setSelectedType(value === 'all' ? null : value)}>
              <SelectTrigger className='w-48' size='sm'>
                <SelectValue placeholder='All types' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All types</SelectItem>
                <SelectSeparator />
                {CREDENTIAL_REGISTRY.map((cred) => (
                  <SelectItem key={cred.id} value={cred.credentialType.name}>
                    {cred.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* View Mode Toggle */}
          <div className='items-center gap-2 md:flex hidden'>
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList className='h-7'>
                <TabsTrigger value='grid' size='sm' className='h-5'>
                  <LayoutGrid className='size-3.5' />
                </TabsTrigger>
                <TabsTrigger value='table' size='sm' className='h-5'>
                  <List className='size-3.5' />
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Create Credential Button */}
          <Button variant='default' size='sm' onClick={() => setCreateDialogOpen(true)}>
            Add Credential
          </Button>
        </div>
      </div>

      {/* Create Credential Dialog */}
      <CreateCredentialDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </>
  )
}
