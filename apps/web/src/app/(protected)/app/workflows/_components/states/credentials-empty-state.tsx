// apps/web/src/app/(protected)/app/workflows/_components/states/credentials-empty-state.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Key, SearchX } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { CreateCredentialDialog } from '~/components/workflow/credentials/create-credential-dialog'

interface CredentialsEmptyStateProps {
  searchQuery?: string
  selectedType?: string | null
  onClearFilters?: () => void
  onSelectType?: (type: string) => void
}

// Popular credential types for quick start (temporary until icon system is implemented)
const POPULAR_CREDENTIALS = [
  { id: 'smtp', displayName: 'SMTP Email' },
  { id: 'airtableApi', displayName: 'Airtable' },
  { id: 'postgres', displayName: 'PostgreSQL' },
  { id: 'oauth2Api', displayName: 'OAuth2' },
]

/**
 * Empty state component for credentials using existing EmptyState
 */
export function CredentialsEmptyState({
  searchQuery,
  selectedType,
  onClearFilters,
  onSelectType,
}: CredentialsEmptyStateProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const hasFilters = searchQuery || selectedType

  if (hasFilters) {
    return (
      <div className='flex flex-col items-center flex-1 h-full'>
        <EmptyState
          icon={SearchX}
          title='No credentials found'
          description={
            <div className='space-y-4 max-w-md'>
              <p>
                No credentials match your current search or filter criteria. Try adjusting your
                search terms or clearing filters.
              </p>
            </div>
          }
          button={
            <div className='flex items-center justify-center gap-3'>
              <Button variant='outline' onClick={onClearFilters}>
                Clear Filters
              </Button>
              <Button
                className='gap-2'
                size='sm'
                variant='outline'
                onClick={() => setCreateDialogOpen(true)}>
                <Key />
                Add Credential
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className='flex flex-col items-center flex-1 h-full'>
      <EmptyState
        icon={Key}
        title='No credentials yet'
        description={
          <div className='space-y-6'>
            <p className='max-w-md mx-auto'>
              Get started by creating your first credential to connect your workflows to external
              services like email, databases, and APIs.
            </p>

            {/* Quick Start Options */}
            <div className='space-y-4'>
              <div className='text-sm text-muted-foreground'>Popular credential types:</div>

              <div className='flex items-center justify-center gap-3 flex-wrap'>
                {POPULAR_CREDENTIALS.map((type) => (
                  <Button
                    key={type.id}
                    variant='outline'
                    size='sm'
                    className='gap-2'
                    onClick={() => onSelectType?.(type.id)}>
                    <Key />
                    {type.displayName}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        }
        button={
          <Button
            className='gap-2'
            variant='outline'
            size='sm'
            onClick={() => setCreateDialogOpen(true)}>
            <Key />
            Add Credential
          </Button>
        }
      />

      {/* Create Credential Dialog */}
      <CreateCredentialDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  )
}
