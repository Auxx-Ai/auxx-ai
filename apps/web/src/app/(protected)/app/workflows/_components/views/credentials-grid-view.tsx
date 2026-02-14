// apps/web/src/app/(protected)/app/workflows/_components/views/credentials-grid-view.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { Copy, Edit, MoreVertical, TestTube, Trash } from 'lucide-react'
import { useState } from 'react'
import {
  getCredentialCategory,
  getCredentialDisplayName,
  getCredentialIcon,
  getCredentialStyling,
} from '~/components/workflow/credentials/credential-styling'
import { useCredentials } from '~/components/workflow/credentials/credentials-provider'
import { EditCredentialDialog } from '~/components/workflow/credentials/edit-credential-dialog'
import { useConfirm } from '~/hooks/use-confirm'

interface CredentialCardProps {
  credential: {
    id: string
    name: string
    type: string
    createdBy: { name: string | null }
    createdAt: Date
  }
  onEdit: (credentialId: string) => void
}

/**
 * Individual credential card component
 */
function CredentialCard({ credential, onEdit }: CredentialCardProps) {
  const { deleteCredential, testCredential } = useCredentials()
  const [isLoading, setIsLoading] = useState(false)
  const [lastTestResult, setLastTestResult] = useState<'success' | 'failed' | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()

  const handleTest = async () => {
    setIsLoading(true)
    try {
      const result = await testCredential(credential.id)
      setLastTestResult(result ? 'success' : 'failed')
    } catch (error) {
      setLastTestResult('failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: `Delete ${credential.name}?`,
      description: 'This action cannot be undone. This credential will be permanently deleted.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await deleteCredential(credential.id)
    }
  }

  const handleEdit = () => {
    onEdit(credential.id)
  }

  const handleDuplicate = () => {
    // TODO: Duplicate credential
    console.log('Duplicate credential:', credential.id)
  }

  // Get styling and metadata from credential definition
  const styling = getCredentialStyling(credential.type)
  const IconComponent = getCredentialIcon(credential.type)
  const displayName = getCredentialDisplayName(credential.type)
  const category = getCredentialCategory(credential.type)

  return (
    <>
      <Card className='group hover:shadow-md transition-all duration-200'>
        <CardHeader>
          <div className='flex items-start justify-between'>
            <div className='relative'>
              <div className='rounded-xl overflow-hidden'>
                <IconComponent className='size-8' />
              </div>
              <div className='absolute -top-1 -right-1'>
                {lastTestResult !== 'success' && (
                  <div
                    className='size-2.5 rounded-full bg-green-500 flex-shrink-0'
                    title='Last test: Success'
                  />
                )}
                {lastTestResult === 'failed' && (
                  <div
                    className='size-2.5 rounded-full bg-red-500 flex-shrink-0'
                    title='Last test: Failed'
                  />
                )}
              </div>
            </div>
            {/* Actions Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='opacity-0 group-hover:opacity-100 transition-opacity'>
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={handleTest} disabled={isLoading}>
                  <TestTube />
                  {isLoading ? 'Testing...' : 'Test Connection'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleEdit}>
                  <Edit />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDuplicate}>
                  <Copy />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleDelete} variant='destructive'>
                  <Trash />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className='flex items-start justify-between'>
            <div className='flex-1 min-w-0'>
              <CardTitle className='text-sm truncate flex items-center gap-2'>
                {credential.name}
              </CardTitle>
              <CardDescription className='truncate'>{displayName}</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className=''>
          {/* Type Badge & Category
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-xs capitalize">
              {category}
            </Badge>
          </div> */}

          {/* Creator Info */}
          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            <span>
              Created{' '}
              <LastUpdated
                timestamp={credential.createdAt}
                prefix=''
                includeSeconds={false}
                className='text-xs'
              />{' '}
              by {credential.createdBy.name || 'Unknown'}{' '}
            </span>
          </div>

          {/* Last Updated */}
        </CardContent>
      </Card>

      <ConfirmDialog />
    </>
  )
}

/**
 * Credentials grid view component
 */
export function CredentialsGridView() {
  const { credentials } = useCredentials()
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingCredentialId, setEditingCredentialId] = useState<string | null>(null)

  const handleEdit = (credentialId: string) => {
    setEditingCredentialId(credentialId)
    setEditDialogOpen(true)
  }

  const handleEditDialogClose = (open: boolean) => {
    setEditDialogOpen(open)
    if (!open) {
      setEditingCredentialId(null)
    }
  }

  return (
    <>
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        {credentials.map((credential) => (
          <CredentialCard key={credential.id} credential={credential} onEdit={handleEdit} />
        ))}
      </div>

      <EditCredentialDialog
        open={editDialogOpen}
        onOpenChange={handleEditDialogClose}
        credentialId={editingCredentialId}
      />
    </>
  )
}
