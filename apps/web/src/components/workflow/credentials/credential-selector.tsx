// apps/web/src/components/workflow/credentials/credential-selector.tsx
'use client'

import { useState, useMemo } from 'react'
import { Search, Plus, Key, CheckCircle, AlertTriangle } from 'lucide-react'
import { Input } from '@auxx/ui/components/input'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Card, CardContent } from '@auxx/ui/components/card'
import { Separator } from '@auxx/ui/components/separator'
import { useCredentials } from './credentials-provider'
import { getCredentialType } from './credential-registry'
import { cn } from '@auxx/ui/lib/utils'

interface CredentialSelectorProps {
  /** Array of credential type IDs to filter by */
  allowedCredentialTypes: string[]

  /** Currently selected credential ID */
  selectedCredentialId?: string | null

  /** Callback when a credential is selected */
  onCredentialSelect: (credentialId: string) => void

  /** Callback when create new credential is clicked */
  onCreateNew: () => void

  /** Hide create new option */
  hideCreateOption?: boolean
}

interface CredentialInfo {
  id: string
  name: string
  type: string
  createdBy: { name: string | null }
  createdAt: Date
}

/**
 * Credential selector component for choosing existing credentials
 */
export function CredentialSelector({
  allowedCredentialTypes,
  selectedCredentialId,
  onCredentialSelect,
  onCreateNew,
  hideCreateOption = false,
}: CredentialSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const { credentials, isLoading, error } = useCredentials()

  // Filter credentials by allowed types
  const filteredCredentials = useMemo(() => {
    if (!credentials) return []

    return credentials.filter((credential: CredentialInfo) => {
      // Check if credential type is allowed
      const isAllowed = allowedCredentialTypes.includes(credential.type)
      if (!isAllowed) return false

      // Apply search filter
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase()
        return (
          credential.name.toLowerCase().includes(searchLower) ||
          credential.type.toLowerCase().includes(searchLower)
        )
      }

      return true
    })
  }, [credentials, allowedCredentialTypes, searchQuery])

  // Group credentials by type
  const credentialsByType = useMemo(() => {
    const grouped: Record<string, CredentialInfo[]> = {}

    filteredCredentials.forEach((credential) => {
      if (!grouped[credential.type]) {
        grouped[credential.type] = []
      }
      grouped[credential.type].push(credential)
    })

    return grouped
  }, [filteredCredentials])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="size-4 border-2 border-current border-r-transparent rounded-full animate-spin" />
          <span>Loading credentials...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Failed to load credentials: {error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      {/* <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search credentials..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div> */}

      {/* Create new credential option */}
      {!hideCreateOption && (
        <>
          <Button variant="default" size="sm" onClick={onCreateNew} className="justify-start">
            <Plus />
            Create New Credential
          </Button>
        </>
      )}

      {/* No results */}
      {/* {filteredCredentials.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Key className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">
            {searchQuery
              ? `No credentials found matching "${searchQuery}"`
              : 'No credentials available for this node'}
          </p>
          {!hideCreateOption && !searchQuery && (
            <Button variant="link" onClick={onCreateNew} className="mt-2">
              Create your first credential
            </Button>
          )}
        </div>
      )} */}

      {/* Credentials grouped by type */}
      {Object.keys(credentialsByType).length > 0 && (
        <div className="space-y-4">
          {Object.entries(credentialsByType).map(([type, typeCredentials]) => {
            const credentialType = getCredentialType(type)
            const Icon = credentialType?.icon || Key

            return (
              <div key={type} className="space-y-2">
                {/* Type header */}
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Icon className="size-4" />
                  <span>{credentialType?.displayName || type}</span>
                  <Badge variant="secondary" className="text-xs">
                    {typeCredentials.length}
                  </Badge>
                </div>

                {/* Credentials of this type */}
                <div className="space-y-2">
                  {typeCredentials.map((credential) => (
                    <CredentialItem
                      key={credential.id}
                      credential={credential}
                      isSelected={credential.id === selectedCredentialId}
                      onSelect={() => onCredentialSelect(credential.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Individual credential item component
 */
function CredentialItem({
  credential,
  isSelected,
  onSelect,
}: {
  credential: CredentialInfo
  isSelected: boolean
  onSelect: () => void
}) {
  const credentialType = getCredentialType(credential.type)
  const Icon = credentialType?.icon || Key

  return (
    <Card
      className={`cursor-pointer transition-colors ${
        isSelected ? 'ring-1 ring-info bg-primary/5' : 'hover:bg-muted/50'
      }`}
      onClick={onSelect}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className={`p-2 rounded-lg ${isSelected ? 'bg-info [&>svg]:text-white' : 'bg-muted'}`}>
              <Icon className="size-4" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className={cn('font-medium truncate', { 'text-info': isSelected })}>
                  {credential.name}
                </p>
                {isSelected && <CheckCircle className="size-4 text-info" />}
              </div>
              <p className="text-sm text-muted-foreground">
                Created by {credential.createdBy?.name || 'Unknown'} •{' '}
                {new Date(credential.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
