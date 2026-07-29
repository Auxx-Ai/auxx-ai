// apps/web/src/components/signatures/ui/signature-list.tsx
'use client'

import type { SignatureItem } from '@auxx/types/signature'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import {
  EyeIcon,
  Feather,
  MoreHorizontal,
  PencilIcon,
  Plus,
  Share2,
  StarIcon,
  Trash2Icon,
} from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { InstanceShareDialog } from '~/components/permissions/ui/instance-share-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import {
  useDefaultSignature,
  useSignatureAccess,
  useSignatureMutations,
  useSignatures,
} from '../hooks'

interface SignatureListProps {
  /** Open the signature dialog in create mode */
  onCreate?: () => void
  /** Open the signature dialog for the given signature id (read-only at `view`) */
  onEdit?: (signatureId: string) => void
}

/**
 * The signatures settings table.
 *
 * Reads `signature.list`, which already FILTERS to what this member may view —
 * so every row here is at least viewable, and the per-row affordances only ever
 * have to distinguish `view` / `edit` / `admin`. That per-row answer comes from
 * {@link useSignatureAccess}; nothing in this file re-derives it.
 *
 * There is no visibility column any more: `signature_visibility` was decorative
 * (nothing ever filtered on it) and migration 057 deleted it. Sharing state now
 * lives in `ResourceAccess` and is edited through the shared
 * {@link InstanceShareDialog}, behind the `admin` rung.
 */
export function SignatureList({ onCreate, onEdit }: SignatureListProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const { signatures, isLoading } = useSignatures()
  const { defaultId } = useDefaultSignature()
  const {
    delete: deleteSignature,
    setDefault,
    isDeleting,
    isSettingDefault,
  } = useSignatureMutations()

  const handleDelete = async (signature: SignatureItem) => {
    const ok = await confirm({
      title: 'Delete Signature',
      description: `Are you sure you want to delete "${signature.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
      cancelText: 'Cancel',
    })
    if (ok) await deleteSignature(signature.id)
  }

  if (isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
      </div>
    )
  }

  return (
    <>
      {!signatures.length ? (
        <EmptyState
          icon={Feather}
          title='No signatures'
          description={
            <div className='max-w-sm'>
              Create a signature to sign off your replies, then share it with teammates who should
              be able to use it.
            </div>
          }
          button={
            onCreate ? (
              <Button size='sm' variant='outline' onClick={onCreate}>
                <Plus />
                Create signature
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Default</TableHead>
              <TableHead className='w-[100px]'>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {signatures.map((signature) => (
              <SignatureRow
                key={signature.id}
                signature={signature}
                isDefault={defaultId === signature.id}
                isSettingDefault={isSettingDefault}
                isDeleting={isDeleting}
                onEdit={onEdit}
                onSetDefault={() => void setDefault(signature.id)}
                onDelete={() => void handleDelete(signature)}
              />
            ))}
          </TableBody>
        </Table>
      )}
      <ConfirmDialog />
    </>
  )
}

interface SignatureRowProps {
  signature: SignatureItem
  isDefault: boolean
  isSettingDefault: boolean
  isDeleting: boolean
  onEdit?: (signatureId: string) => void
  onSetDefault: () => void
  onDelete: () => void
}

/**
 * One row. Its own component purely so {@link useSignatureAccess} can be called
 * per signature — instance access is per row, and hooks cannot run inside a map.
 */
function SignatureRow({
  signature,
  isDefault,
  isSettingDefault,
  isDeleting,
  onEdit,
  onSetDefault,
  onDelete,
}: SignatureRowProps) {
  const [shareOpen, setShareOpen] = useState(false)
  const { canEdit, canAdmin } = useSignatureAccess(signature.id)

  return (
    <>
      {/* Trigger AND dialog both behind `canAdmin` — a stray `open` prop on an
          always-mounted dialog is the #1355 bug. */}
      {canAdmin && (
        <InstanceShareDialog
          recordId={signature.recordId}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
      <TableRow>
        <TableCell className='font-medium'>{signature.name}</TableCell>
        <TableCell>
          {isDefault ? (
            <StarIcon className='h-5 w-5 fill-yellow-500 text-yellow-500' />
          ) : (
            // `view`, not `edit`: setDefault writes only the CALLER's own
            // `UserSetting` row, so preferring a signature someone shared with
            // you needs no write rung on the signature itself (plan 36 §12.2).
            // Every row in this list is viewable, so no extra gate is needed.
            <Button variant='ghost' size='sm' onClick={onSetDefault} disabled={isSettingDefault}>
              Set Default
            </Button>
          )}
        </TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon-sm'>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => onEdit?.(signature.id)}>
                {canEdit ? <PencilIcon /> : <EyeIcon />}
                {canEdit ? 'Edit' : 'View'}
              </DropdownMenuItem>
              {canAdmin && (
                <DropdownMenuItem onClick={() => setShareOpen(true)}>
                  <Share2 />
                  Share…
                </DropdownMenuItem>
              )}
              {canAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant='destructive' disabled={isDeleting} onClick={onDelete}>
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    </>
  )
}
