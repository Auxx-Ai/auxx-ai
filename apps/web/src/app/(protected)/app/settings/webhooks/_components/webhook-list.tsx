// apps/web/src/app/(protected)/app/settings/webhooks/_components/webhook-list.tsx
'use client'
import type { WebhookEntity as Webhook } from '@auxx/database/models'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@auxx/ui/components/alert-dialog'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { Check, CopyIcon, Edit, MoreHorizontal, Trash2, Webhook as WebhookIcon } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { DialogWebhook } from './dialog-webhook'
import { useWebhook } from './use-webhook'
export function WebhookList({ empty }: { empty: React.ReactNode }) {
  const { data: webhooks, isLoading, destroy, isDestroying } = useWebhook()
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null)
  const [webhookToDelete, setWebhookToDelete] = useState<Webhook | null>(null)
  const [expandedEventTypes, setExpandedEventTypes] = useState<Set<string>>(new Set())
  const { copy: copySecret, copied } = useCopy({ toastMessage: 'Secret copied to clipboard' })
  return (
    <>
      {isLoading ? (
        <EmptyState
          icon={WebhookIcon}
          iconClassName='animate-spin'
          title='Loading Webhooks...'
          description='&nbsp;'
          button={<div className='h-9'></div>}
        />
      ) : webhooks?.length === 0 ? (
        empty
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Secret</TableHead>
              <TableHead>Event Types</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className='w-[100px]'>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhooks?.map((webhook) => (
              <TableRow key={webhook.id}>
                <TableCell className='font-medium'>{webhook.name}</TableCell>
                <TableCell className='font-mono text-sm truncate max-w-[300px]'>
                  {webhook.url}
                </TableCell>
                <TableCell>
                  <div className='flex items-center space-x-2'>
                    <span className='font-mono'>•••••••</span>
                    <Button variant='ghost' size='sm' onClick={() => copySecret(webhook.secret)}>
                      {copied ? <Check /> : <CopyIcon />}
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <div className='flex flex-wrap gap-1'>
                    {webhook.eventTypes.length > 0 ? (
                      <>
                        {(expandedEventTypes.has(webhook.id)
                          ? webhook.eventTypes
                          : webhook.eventTypes.slice(0, 1)
                        ).map((type) => (
                          <Badge key={type} variant='outline'>
                            {type}
                          </Badge>
                        ))}
                        {webhook.eventTypes.length > 1 && (
                          <Badge
                            variant='secondary'
                            className='cursor-pointer'
                            onClick={() => {
                              setExpandedEventTypes((prev) => {
                                const next = new Set(prev)
                                if (next.has(webhook.id)) {
                                  next.delete(webhook.id)
                                } else {
                                  next.add(webhook.id)
                                }
                                return next
                              })
                            }}>
                            {expandedEventTypes.has(webhook.id)
                              ? 'Show less'
                              : `+${webhook.eventTypes.length - 1} more`}
                          </Badge>
                        )}
                      </>
                    ) : (
                      <span className='text-muted-foreground'>None</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={webhook.isActive ? 'default' : 'secondary'}>
                    {webhook.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='ghost' size='icon-sm'>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem onClick={() => setEditingWebhook(webhook)}>
                        <Edit />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant='destructive'
                        onClick={() => setWebhookToDelete(webhook)}>
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Edit Webhook Dialog */}
      {editingWebhook && (
        <DialogWebhook
          open={!!editingWebhook}
          onClose={() => setEditingWebhook(null)}
          webhook={editingWebhook}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!webhookToDelete}
        onOpenChange={(open) => !open && setWebhookToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the webhook "{webhookToDelete?.name}". This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground'
              onClick={() => {
                if (webhookToDelete) {
                  destroy.mutate({ id: webhookToDelete.id })
                  setWebhookToDelete(null)
                }
              }}
              disabled={isDestroying === webhookToDelete?.id}>
              {isDestroying === webhookToDelete?.id ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
