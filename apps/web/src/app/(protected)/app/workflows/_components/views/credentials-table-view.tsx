// apps/web/src/app/(protected)/app/workflows/_components/views/credentials-table-view.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Copy, Edit, MoreHorizontal, TestTube, Trash } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import {
  getCredentialCategory,
  getCredentialDisplayName,
  getCredentialIcon,
  getCredentialStyling,
} from '../../../../../../components/workflow/credentials/credential-styling'
import { useCredentials } from '../../../../../../components/workflow/credentials/credentials-provider'
import { EditCredentialDialog } from '../../../../../../components/workflow/credentials/edit-credential-dialog'

/**
 * Credentials table view component
 */
export function CredentialsTableView() {
  const { credentials, deleteCredential, testCredential } = useCredentials()
  const [loadingTests, setLoadingTests] = useState<Set<string>>(new Set())
  const [testResults, setTestResults] = useState<Map<string, 'success' | 'failed'>>(new Map())
  const [confirm, ConfirmDialog] = useConfirm()
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingCredentialId, setEditingCredentialId] = useState<string | null>(null)

  const handleTest = async (credentialId: string) => {
    setLoadingTests((prev) => new Set(prev).add(credentialId))
    try {
      const result = await testCredential(credentialId)
      setTestResults((prev) => new Map(prev).set(credentialId, result ? 'success' : 'failed'))
    } catch (error) {
      setTestResults((prev) => new Map(prev).set(credentialId, 'failed'))
    } finally {
      setLoadingTests((prev) => {
        const newSet = new Set(prev)
        newSet.delete(credentialId)
        return newSet
      })
    }
  }

  const handleDelete = async (credential: any) => {
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

  const handleDuplicate = (credentialId: string) => {
    // TODO: Duplicate credential
    console.log('Duplicate credential:', credentialId)
  }

  return (
    <>
      <div className='border rounded-lg'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className='w-[100px]'>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {credentials.map((credential) => {
              const isTestLoading = loadingTests.has(credential.id)
              const testResult = testResults.get(credential.id)

              // Get styling and metadata from credential definition
              const styling = getCredentialStyling(credential.type)
              const IconComponent = getCredentialIcon(credential.type)
              const displayName = getCredentialDisplayName(credential.type)
              const category = getCredentialCategory(credential.type)

              return (
                <TableRow key={credential.id}>
                  <TableCell className='font-medium'>
                    <div className='flex items-center gap-3'>
                      <div
                        className={`p-1.5 rounded bg-gradient-to-br ${styling.backgroundColor} ${styling.iconColor}`}>
                        <IconComponent className='h-4 w-4' />
                      </div>
                      {credential.name}
                    </div>
                  </TableCell>
                  <TableCell>{displayName}</TableCell>
                  <TableCell>
                    <Badge variant='outline' className='capitalize'>
                      {category}
                    </Badge>
                  </TableCell>
                  <TableCell>{credential.createdBy.name || 'Unknown'}</TableCell>
                  <TableCell>
                    <LastUpdated
                      timestamp={credential.createdAt}
                      includeSeconds={false}
                      className='text-sm'
                    />
                  </TableCell>
                  <TableCell>
                    {testResult === 'success' && (
                      <div className='flex items-center gap-2'>
                        <div className='h-2 w-2 rounded-full bg-green-500' />
                        <span className='text-sm text-green-600'>Tested</span>
                      </div>
                    )}
                    {testResult === 'failed' && (
                      <div className='flex items-center gap-2'>
                        <div className='h-2 w-2 rounded-full bg-red-500' />
                        <span className='text-sm text-red-600'>Failed</span>
                      </div>
                    )}
                    {!testResult && <span className='text-sm text-muted-foreground'>Untested</span>}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant='ghost' size='icon-sm'>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem
                          onClick={() => handleTest(credential.id)}
                          disabled={isTestLoading}>
                          <TestTube />
                          {isTestLoading ? 'Testing...' : 'Test Connection'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEdit(credential.id)}>
                          <Edit />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(credential.id)}>
                          <Copy />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDelete(credential)}
                          variant='destructive'>
                          <Trash />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <EditCredentialDialog
        open={editDialogOpen}
        onOpenChange={handleEditDialogClose}
        credentialId={editingCredentialId}
      />

      <ConfirmDialog />
    </>
  )
}
