// ~/components/signatures/signature-list.tsx
'use client'
import React from 'react'
import { useRouter } from 'next/navigation'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  MoreHorizontal,
  PencilIcon,
  Trash2Icon,
  StarIcon,
  PlugIcon,
  LockIcon,
  GlobeIcon,
  Plus,
  Feather,
} from 'lucide-react'
// import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { EmptyState } from '~/components/global/empty-state'
import Link from 'next/link'
import { SignatureSharingType } from '@auxx/database/enums'
type Signature = {
  id: string
  name: string
  body: string
  isDefault: boolean
  sharingType: SignatureSharingType
  createdById: string
  sharedIntegrations?: Array<{
    integrationId: string
    integration: {
      id: string
      email: string
    }
  }>
  createdAt: Date
  updatedAt: Date
}
interface SignatureListProps {
  signatures: Signature[]
  isAdmin?: boolean
}
export function SignatureList({ signatures, isAdmin = false }: SignatureListProps) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  // tRPC mutations
  const deleteSignature = api.signature.delete.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Signature deleted',
        description: 'The signature has been deleted successfully.',
      })
      router.refresh()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting signature', description: error.message })
    },
  })
  const setDefaultSignature = api.signature.setDefault.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Default signature updated',
        description: 'Your default signature has been updated.',
      })
      router.refresh()
    },
    onError: (error) => {
      toastError({ title: 'Error updating default signature', description: error.message })
    },
  })
  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Delete Signature',
      description: 'Are you sure you want to delete this signature? This action cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
      cancelText: 'Cancel',
    })
    if (ok) {
      deleteSignature.mutate({ id })
    }
  }
  const handleSetDefault = (id: string) => {
    setDefaultSignature.mutate({ id })
  }
  // Helper function to get sharing type display info
  const getSharingInfo = (signature: Signature) => {
    switch (signature.sharingType) {
      case SignatureSharingType.PRIVATE:
        return {
          label: 'Private',
          icon: <LockIcon className="mr-1 h-4 w-4" />,
          color: 'bg-gray-100 text-gray-800',
          detail: 'Only you',
        }
      case SignatureSharingType.ORGANIZATION_WIDE:
        return {
          label: 'Organization',
          icon: <GlobeIcon className="mr-1 h-4 w-4" />,
          color: 'bg-blue-100 text-blue-800',
          detail: 'All users & integrations',
        }
      case SignatureSharingType.SPECIFIC_INTEGRATIONS:
        return {
          label: 'Shared',
          icon: <PlugIcon className="mr-1 h-4 w-4" />,
          color: 'bg-green-100 text-green-800',
          detail: `${signature.sharedIntegrations?.length || 0} integrations`,
        }
      default:
        return { label: 'Unknown', icon: null, color: 'bg-gray-100 text-gray-800', detail: '' }
    }
  }
  return (
    <>
      {!signatures.length ? (
        <EmptyState
          icon={Feather}
          title="No signatures"
          description={
            <div className="max-w-sm">
              Give your teammates access to predefined signatures on email channels by creating
              shared signatures.
            </div>
          }
          button={
            <Link href="/app/settings/signatures/new" asChild>
              <Button size="sm" variant="outline" onClick={() => {}}>
                <Plus />
                Create signature
              </Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Sharing</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead>Default</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {signatures.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center">
                  No signatures found. Create your first signature to get started.
                </TableCell>
              </TableRow>
            ) : (
              signatures.map((signature) => {
                const sharingInfo = getSharingInfo(signature)
                return (
                  <TableRow key={signature.id}>
                    <TableCell className="font-medium">{signature.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`inline-flex items-center ${sharingInfo.color}`}>
                        {sharingInfo.icon}
                        {sharingInfo.label}
                        {sharingInfo.detail && (
                          <span className="ml-1 text-xs opacity-70">({sharingInfo.detail})</span>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(signature.updatedAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {signature.isDefault ? (
                        <StarIcon className="h-5 w-5 text-yellow-500" />
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetDefault(signature.id)}>
                          Set Default
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              router.push(`/app/settings/signatures/${signature.id}/edit`)
                            }>
                            <PencilIcon />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDelete(signature.id)}>
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      )}
      <ConfirmDialog />
    </>
  )
}
