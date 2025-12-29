'use client'

import { Letter } from 'react-letter'
import { api, type RouterOutputs } from '~/trpc/react'
import React, { useEffect, useRef, useState } from 'react'
import { useLocalStorage } from 'usehooks-ts'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import Avatar from 'react-avatar'
import { Button } from '@auxx/ui/components/button'
import {
  Copy,
  Pencil,
  Trash,
  MessageSquarePlus,
  CheckCircle,
  X,
  ImageIcon,
  FileTextIcon,
  FileIcon,
  Paperclip,
  Download,
} from 'lucide-react'
import { Textarea } from '@auxx/ui/components/textarea'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { useRouter } from 'next/navigation'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@auxx/ui/components/tooltip'
import { useUser } from '~/hooks/use-user'

import { formatBytes } from '@auxx/lib/utils'
type TicketReply = { reply: RouterOutputs['ticket']['byId']['replies'][number] }

/**
 * Displays ticket message/reply with edit/delete functionality
 */
const TicketMessage = ({ reply }: TicketReply) => {
  const letterRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(reply.content || '')
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isConvertDialogOpen, setIsConvertDialogOpen] = useState(false)
  const [newTicketTitle, setNewTicketTitle] = useState('')

  const { user } = useUser()
  // Fetch attachments for this reply
  // const { data: attachmentsData } = api.ticketAttachment.all.useQuery(
  //   { ticketId: reply.ticketId },
  //   {
  //     select: (data) => {
  //       console.log(data, reply, reply.id)
  //       return { attachments: data.attachments.filter((a) => a.replyId === reply.id) }
  //     },
  //     enabled: Boolean(reply.id && reply.ticketId),
  //   }
  // )
  const attachments = [] // TODO IMPLEMENT. attachmentsData?.attachments || []
  // Mutations
  const updateReply = api.ticket.updateReply.useMutation({
    onSuccess: () => {
      setIsEditing(false)
      // You might want to refetch the ticket data here or use optimistic updates
    },
  })

  const deleteReply = api.ticket.deleteReply.useMutation({
    onSuccess: () => {
      setIsDeleteDialogOpen(false)
      // You might want to refetch the ticket data here or use optimistic updates
    },
  })

  const convertToTicket = api.ticket.convertReplyToTicket.useMutation({
    onSuccess: (data) => {
      setIsConvertDialogOpen(false)
      // Navigate to the new ticket
      if (data?.id) {
        router.push(`/app/tickets/${data.id}`)
      }
    },
  })

  useEffect(() => {
    if (letterRef.current) {
      const gmailQuote = letterRef.current.querySelector('div[class*="_gmail_quote"]')
      if (gmailQuote) {
        gmailQuote.innerHTML = ''
      }
    }
  }, [reply])

  const handleSaveEdit = async () => {
    await updateReply.mutateAsync({ id: reply.id, content: editedContent })
  }

  const handleDelete = async () => {
    await deleteReply.mutateAsync({ id: reply.id })
  }

  const handleConvertToTicket = async () => {
    await convertToTicket.mutateAsync({
      replyId: reply.id,
      title: newTicketTitle || `New ticket from ${reply.senderEmail}`,
    })
  }

  const getFileIcon = (contentType: string) => {
    if (contentType.startsWith('image/')) {
      return <ImageIcon className="h-4 w-4" />
    } else if (contentType.includes('pdf')) {
      return <FileTextIcon className="h-4 w-4" />
    } else {
      return <FileIcon className="h-4 w-4" />
    }
  }

  const isMe = user?.email === reply.senderEmail
  const isCustomer = !isMe

  return (
    <div
      className={cn('group relative rounded-md border bg-background p-4 transition-all', {
        'border-l-4 border-l-gray-900': isMe,
      })}
      ref={letterRef}>
      {/* Action buttons */}
      <div className="invisible absolute right-2 top-2 flex gap-2 group-hover:visible">
        <div className="shadow-2xs inline-flex rounded-md rtl:space-x-reverse">
          <Button
            className="rounded-none text-primary shadow-none first:rounded-s-md last:rounded-e-md focus-visible:z-10"
            variant="outline"
            size="icon"
            aria-label="Edit"
            onClick={() => setIsEditing(true)}>
            <Pencil size={16} aria-hidden="true" />
          </Button>
          <Button
            className="rounded-none text-red-500 shadow-none first:rounded-s-md last:rounded-e-md focus-visible:z-10"
            variant="outline"
            size="icon"
            aria-label="Delete"
            onClick={() => setIsDeleteDialogOpen(true)}>
            <Trash size={16} aria-hidden="true" />
          </Button>
          {isCustomer && (
            <Button
              className="rounded-none text-red-500 shadow-none first:rounded-s-md last:rounded-e-md focus-visible:z-10"
              variant="outline"
              size="icon"
              aria-label="Convert to ticket"
              onClick={() => setIsConvertDialogOpen(true)}>
              <MessageSquarePlus size={16} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {/* Header section with sender info */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {!isMe && (
            <Avatar
              name={reply.senderEmail ?? ''}
              email={reply.senderEmail}
              size="35"
              textSizeRatio={2}
              round={true}
            />
          )}
          <span className="font-medium">{isMe ? 'Me' : reply.senderEmail}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(reply.createdAt ?? new Date(), { addSuffix: true })}
        </p>
      </div>
      <div className="h-4"></div>

      {/* Message content - either in edit mode or display mode */}
      {isEditing ? (
        <div className="space-y-4">
          <Textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            rows={6}
            className="w-full"
          />
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsEditing(false)
                setEditedContent(reply.content || '')
              }}>
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSaveEdit}
              disabled={updateReply.isPending}>
              <CheckCircle className="mr-2 h-4 w-4" />
              {updateReply.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      ) : (
        <Letter
          className="rounded-md bg-background text-black dark:text-white"
          html={reply.content ?? ''}
        />
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <div className="mb-2 flex items-center text-sm text-muted-foreground">
            <Paperclip className="mr-1 h-4 w-4" />
            <span>Attachments ({attachments.length})</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="flex items-center rounded-md border p-2 text-sm">
                <span className="mr-2 text-muted-foreground">
                  {getFileIcon(attachment.contentType)}
                </span>
                <div className="flex-1 overflow-hidden">
                  <p className="truncate">{attachment.filename}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Download file</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the message.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteReply.isPending}>
              {deleteReply.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Convert to ticket dialog */}
      <Dialog open={isConvertDialogOpen} onOpenChange={setIsConvertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to new ticket</DialogTitle>
            <DialogDescription>
              Create a new ticket from this customer message. The content will be used as the
              initial message.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ticket-title">Ticket title</Label>
                <Input
                  id="ticket-title"
                  placeholder="Enter ticket title"
                  value={newTicketTitle}
                  onChange={(e) => setNewTicketTitle(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConvertDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConvertToTicket} disabled={convertToTicket.isPending}>
              {convertToTicket.isPending ? 'Creating...' : 'Create ticket'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default TicketMessage
