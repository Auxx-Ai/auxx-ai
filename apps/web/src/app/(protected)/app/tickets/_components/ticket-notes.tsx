import { format } from 'date-fns'
import {
  BoltIcon,
  ChevronDownIcon,
  CopyPlusIcon,
  MoreVertical,
  RefreshCw,
  Send,
  Trash,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { toastError, toastInfo, toastSuccess } from '@auxx/ui/components/toast'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '@auxx/ui/components/timeline'
import { api } from '~/trpc/react'
import type { Ticket } from '@auxx/database/types'
export default function TicketNotes({
  ticket,
  onSubmit,
  showAddNotes,
}: {
  ticket: Ticket
  onSubmit?: () => void
  showAddNotes?: boolean
}) {
  const [newNote, setNewNote] = useState('')
  // const [showAddNote, setShowAddNote] = useState(false)
  const [isInternalNote, setIsInternalNote] = useState(false)
  const ticketId = ticket.id
  const addNote = api.ticket.addNote.useMutation({
    onSuccess: () => {
      if (onSubmit) onSubmit()
      // refetch()
      setNewNote('')
    },
  })
  const deleteNote = api.ticket.deleteNote.useMutation({
    onSuccess: () => {
      if (onSubmit) onSubmit()
    },
  })
  const handleSubmitNote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newNote.trim()) return
    await addNote.mutateAsync({ ticketId, content: newNote, isInternal: isInternalNote })
  }
  const handleCopy = (noteId: string) => {
    const note = ticket.notes.find((note) => note.id === noteId)
    navigator.clipboard.writeText(note?.content)
    toast('Note copied to clipboard')
  }
  const handleDelete = async (noteId: string) => {
    const note = ticket.notes.find((note) => note.id === noteId)
    if (!note) return
    const result = await deleteNote.mutateAsync({ noteId })
    if (result) {
      toastSuccess({ title: 'Note deleted', description: note.content })
    } else {
      toastError({ title: 'Error deleting note', description: 'Could not delete the note.' })
    }
  }
  return (
    <>
      <Timeline>
        {ticket.notes.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">
            No notes yet. Add the first one below.
          </div>
        ) : (
          ticket.notes.map((note) => (
            <TimelineItem
              key={note.id}
              step={note.id}
              className="not-last:group-data-[orientation=vertical]/timeline:pb-8 group-data-[orientation=vertical]/timeline:ms-10">
              <TimelineHeader>
                <TimelineSeparator className="group-data-[orientation=vertical]/timeline:translate-y-6.5 group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.25rem)]" />
                <TimelineTitle className="mt-0.5">
                  <div className="flex justify-between">
                    <div className="flex items-center">
                      {note.author.name}
                      <span className="ml-1 text-sm font-normal text-muted-foreground">
                        wrote a comment
                      </span>
                      <div>
                        {note.isInternal && (
                          <Badge variant="outline" className="ml-2">
                            Internal
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="rounded-full shadow-none">
                            <MoreVertical aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => handleCopy(note.id)}>
                            <CopyPlusIcon className="opacity-60" aria-hidden="true" />
                            Copy
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <BoltIcon className="opacity-60" aria-hidden="true" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDelete(note.id)}
                            variant="destructive">
                            <Trash />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </TimelineTitle>
                <TimelineIndicator className="group-data-completed/timeline-item:bg-primary group-data-completed/timeline-item:text-primary-foreground flex size-6 items-center justify-center border-none bg-primary/10 group-data-[orientation=vertical]/timeline:-left-7">
                  <Avatar className="h-5 w-5">
                    <AvatarFallback>{note.author.name?.substring(0, 1) || 'U'}</AvatarFallback>
                  </Avatar>
                </TimelineIndicator>
              </TimelineHeader>
              <TimelineContent className="mt-2 rounded-lg border px-4 py-3 text-foreground">
                {note.content}
                <TimelineDate className="mb-0 mt-1">
                  {format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a")}
                </TimelineDate>
              </TimelineContent>
            </TimelineItem>
          ))
        )}
      </Timeline>
      {showAddNotes && (
        <form onSubmit={handleSubmitNote} className="mt-6">
          <div className="flex">
            <Textarea
              placeholder="Add a note..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="min-h-24 flex-1 bg-background"
            />
          </div>
          <div className="mt-2 flex justify-between">
            <div className="flex items-center">
              <Label htmlFor="internal-toggle" className="mr-2 text-sm">
                Internal Note
              </Label>
              <Switch
                id="internal-toggle"
                checked={isInternalNote}
                onCheckedChange={setIsInternalNote}
              />
            </div>
            <div>
              <Button type="submit" disabled={!newNote.trim() || addNote.isPending}>
                {addNote.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Add Note
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      )}
    </>
  )
}
