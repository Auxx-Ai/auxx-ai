// apps/web/src/app/(protected)/app/workflows/_components/credentials/credential-type-selector.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Search } from 'lucide-react'
import { useState } from 'react'
import {
  CREDENTIAL_CATEGORIES,
  CREDENTIAL_REGISTRY,
  type CredentialTypeMetadata,
} from './credential-registry'

interface CredentialTypeSelectorProps {
  onSelect: (credentialType: CredentialTypeMetadata) => void
  selectedType?: string
  allowedCredentialTypes?: string[] // Optional - if not provided, shows all types
}

/**
 * Credential type card component
 */
function CredentialTypeCard({
  credential,
  isSelected,
  onSelect,
}: {
  credential: CredentialTypeMetadata
  isSelected: boolean
  onSelect: () => void
}) {
  const Icon = credential.icon

  return (
    <Button
      variant={isSelected ? 'default' : 'outline'}
      className='h-auto p-2 flex flex-col items-start gap-1 text-left hover:shadow-md transition-shadow'
      onClick={onSelect}>
      <div className='flex gap-1 w-full'>
        {/* <div className={`p-2 h-8 rounded-lg ${isSelected ? 'bg-white/20' : 'bg-muted'}`}> */}
        <Icon className='size-6!' />
        {/* </div> */}
        <div className='flex-1 ml-1 flex items-center flex-row justify-between min-w-0'>
          <h3 className='font-medium truncate'>{credential.displayName}</h3>
          <Badge variant='secondary' className='text-xs mt-1'>
            {CREDENTIAL_CATEGORIES[credential.category]}
          </Badge>
        </div>
      </div>
      <p className='truncate text-wrap text-sm opacity-50'>{credential.description}</p>
    </Button>
  )
}

/**
 * Category section component
 */
function CategorySection({
  category,
  credentials,
  selectedType,
  onSelect,
}: {
  category: keyof typeof CREDENTIAL_CATEGORIES
  credentials: CredentialTypeMetadata[]
  selectedType?: string
  onSelect: (credential: CredentialTypeMetadata) => void
}) {
  if (credentials.length === 0) return null

  return (
    <div className='space-y-3'>
      <h3 className='font-medium text-sm text-muted-foreground uppercase tracking-wide'>
        {CREDENTIAL_CATEGORIES[category]}
      </h3>
      <div className='grid gap-3 '>
        {credentials.map((credential) => (
          <CredentialTypeCard
            key={credential.id}
            credential={credential}
            isSelected={selectedType === credential.id}
            onSelect={() => onSelect(credential)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Credential type selector component
 */
export function CredentialTypeSelector({
  onSelect,
  selectedType,
  allowedCredentialTypes,
}: CredentialTypeSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')
  console.log(allowedCredentialTypes)
  // Filter credentials based on allowed types and search
  const filteredCredentials = (() => {
    let credentials = CREDENTIAL_REGISTRY

    // Filter by allowed types if provided
    if (allowedCredentialTypes && allowedCredentialTypes.length > 0) {
      credentials = credentials.filter((cred) => allowedCredentialTypes.includes(cred.id))
    }

    // Apply search filter
    if (searchQuery) {
      credentials = credentials.filter(
        (cred) =>
          cred.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          cred.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          cred.category.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    return credentials
  })()

  // Group by category
  const categorizedCredentials = {
    auth: filteredCredentials.filter((c) => c.category === 'auth'),
    email: filteredCredentials.filter((c) => c.category === 'email'),
    social: filteredCredentials.filter((c) => c.category === 'social'),
    ecommerce: filteredCredentials.filter((c) => c.category === 'ecommerce'),
    data: filteredCredentials.filter((c) => c.category === 'data'),
    database: filteredCredentials.filter((c) => c.category === 'database'),
    storage: filteredCredentials.filter((c) => c.category === 'storage'),
  }

  return (
    <div className='space-y-6'>
      {/* Search */}
      <div className='relative'>
        <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground' />
        <Input
          placeholder='Search credential types...'
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className='pl-10'
        />
      </div>

      {/* No results */}
      {filteredCredentials.length === 0 && (
        <div className='text-center py-8 text-muted-foreground'>
          <p>No credential types found matching "{searchQuery}"</p>
        </div>
      )}

      {/* Categories */}
      {filteredCredentials.length > 0 && (
        <div className='space-y-8'>
          {(Object.keys(categorizedCredentials) as Array<keyof typeof categorizedCredentials>).map(
            (category) => (
              <CategorySection
                key={category}
                category={category}
                credentials={categorizedCredentials[category]}
                selectedType={selectedType}
                onSelect={onSelect}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}
