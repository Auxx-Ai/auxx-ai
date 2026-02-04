// apps/web/src/components/signatures/ui/signature-list.tsx
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
  LockIcon,
  GlobeIcon,
  UsersIcon,
  Plus,
  Feather,
  Loader2,
} from 'lucide-react'
import { toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { EmptyState } from '~/components/global/empty-state'
import Link from 'next/link'
import { useSignatures, useSignatureMutations, type SignatureVisibility } from '../hooks'
import { Skeleton } from '@auxx/ui/components/skeleton'

interface SignatureListProps {
  isAdmin?: boolean
}

/**
 * Signature list component for the settings page.
 * Displays all signatures in a table with edit/delete actions.
 * Uses the entity system via useSignatures hook.
 */
export function SignatureList({ isAdmin = false }: SignatureListProps) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  const { signatures, isLoading, refresh } = useSignatures()
  const { delete: deleteSignature, update, isDeleting, isUpdating } = useSignatureMutations()

  /**
   * Handle delete with confirmation
   */
  const handleDelete = async (recordId: string | undefined, name: string) => {
    if (!recordId) {
      toastError({ title: 'Error', description: 'Cannot delete signature: missing record ID' })
      return
    }

    const ok = await confirm({
      title: 'Delete Signature',
      description: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
      cancelText: 'Cancel',
    })

    if (ok) {
      await deleteSignature(recordId)
      refresh()
    }
  }

  /**
   * Handle set as default
   */
  const handleSetDefault = async (recordId: string | undefined) => {
    if (!recordId) {
      toastError({ title: 'Error', description: 'Cannot set default: missing record ID' })
      return
    }

    // First, unset any existing default signatures
    const currentDefault = signatures.find((s) => s.isDefault)
    if (currentDefault?.recordId) {
      await update(currentDefault.recordId, { isDefault: false })
    }

    // Set the new default
    await update(recordId, { isDefault: true })
    refresh()
  }

  /**
   * Helper function to get visibility display info
   */
  const getVisibilityInfo = (visibility: SignatureVisibility) => {
    switch (visibility) {
      case 'private':
        return {
          label: 'Private',
          icon: <LockIcon className="mr-1 h-4 w-4" />,
          color: 'bg-gray-100 text-gray-800',
          detail: 'Only you',
        }
      case 'org_members':
        return {
          label: 'Organization',
          icon: <GlobeIcon className="mr-1 h-4 w-4" />,
          color: 'bg-blue-100 text-blue-800',
          detail: 'All members',
        }
      case 'custom':
        return {
          label: 'Custom',
          icon: <UsersIcon className="mr-1 h-4 w-4" />,
          color: 'bg-green-100 text-green-800',
          detail: 'Selected groups',
        }
      default:
        return { label: 'Unknown', icon: null, color: 'bg-gray-100 text-gray-800', detail: '' }
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
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
              <TableHead>Visibility</TableHead>
              <TableHead>Default</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {signatures.map((signature) => {
              const visibilityInfo = getVisibilityInfo(signature.visibility)
              return (
                <TableRow key={signature.id}>
                  <TableCell className="font-medium">{signature.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`inline-flex items-center ${visibilityInfo.color}`}>
                      {visibilityInfo.icon}
                      {visibilityInfo.label}
                      {visibilityInfo.detail && (
                        <span className="ml-1 text-xs opacity-70">({visibilityInfo.detail})</span>
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {signature.isDefault ? (
                      <StarIcon className="h-5 w-5 text-yellow-500" />
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetDefault(signature.recordId)}
                        disabled={isUpdating}>
                        {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Set Default'}
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
                          disabled={isDeleting}
                          onClick={() => handleDelete(signature.recordId, signature.name)}>
                          <Trash2Icon />
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
      )}
      <ConfirmDialog />
    </>
  )
}
