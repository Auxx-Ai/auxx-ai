// apps/web/src/app/(protected)/app/workflows/_components/filters/credentials-filter-bar.tsx
'use client'

import React, { useState } from 'react'
import { Search, LayoutGrid, List, Plus } from 'lucide-react'
import { Input } from '@auxx/ui/components/input'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { useCredentials } from '~/components/workflow/credentials/credentials-provider'
import { CreateCredentialDialog } from '~/components/workflow/credentials/create-credential-dialog'
import { CREDENTIAL_REGISTRY } from '~/components/workflow/credentials/credential-registry'

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
      <div className="flex items-center gap-3 p-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search credentials..."
              size="sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 w-full min-w-50"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Type Filter */}
          <Select
            value={selectedType || 'all'}
            onValueChange={(value) => setSelectedType(value === 'all' ? null : value)}>
            <SelectTrigger className="w-48" size="sm">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectSeparator />
              {CREDENTIAL_REGISTRY.map((cred) => (
                <SelectItem key={cred.id} value={cred.credentialType.name}>
                  {cred.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* View Mode Toggle */}
          <div className="items-center gap-2 md:flex hidden">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList className="h-7">
                <TabsTrigger value="grid" size="sm" className="h-5">
                  <LayoutGrid className="size-3.5" />
                </TabsTrigger>
                <TabsTrigger value="table" size="sm" className="h-5">
                  <List className="size-3.5" />
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Create Credential Button */}
          <Button variant="default" size="sm" onClick={() => setCreateDialogOpen(true)}>
            Add Credential
          </Button>
        </div>
      </div>

      {/* Create Credential Dialog */}
      <CreateCredentialDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </>
  )
}
