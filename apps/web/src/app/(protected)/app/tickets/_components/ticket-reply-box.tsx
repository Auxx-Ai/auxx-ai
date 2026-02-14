// ~/components/ticket/TicketReplyBox.tsx (Adjust path as needed)

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Separator } from '@auxx/ui/components/separator'
import { toastError, toastSuccess } from '@auxx/ui/components/toast' // Adjust path
import { AudioLines, Leaf, Plus, X } from 'lucide-react'
import React, { type MouseEvent, useEffect, useId, useState } from 'react' // Added MouseEvent
import { EditorToolbar } from '~/components/editor/editor-button' // Adjust path
import { EditorProvider, useEditorContext } from '~/components/editor/editor-context' // Adjust path

// --- Editor Imports ---
import TiptapEditor from '~/components/editor/tiptap-editor' // Adjust path
import { api, type RouterOutputs } from '~/trpc/react'

// --- End Editor Imports ---

type Props = {
  ticket: RouterOutputs['ticket']['byId']
  onSuccess?: () => void
  onCancel?: () => void
}

type Contact = { id: string; email: string; name?: string; type: 'agent' | 'customer' | 'cc' }

// Selectors for elements that should NOT trigger editor focus when clicked
const INTERACTIVE_ELEMENT_SELECTORS = [
  'button', // Standard buttons
  'a', // Links
  'input', // Input fields
  'select', // Select dropdowns
  'textarea', // Text areas
  '[role="button"]', // Elements acting as buttons
  '[role="option"]', // Options in selects/menus
  '[role="combobox"]', // Combobox inputs
  '[role="menuitem"]', // Menu items
  '[role="tab"]', // Tab elements
  '.ProseMirror', // The actual Tiptap editor content area
  '[data-radix-popper-content-wrapper]', // Shadcn Popover/Select/Dropdown Content
  '[data-radix-select-trigger]', // Shadcn Select Trigger specifically
  '.tippy-box', // Tippy.js popups (used by default slash command renderer)
  '.editor-toolbar-wrapper', // Custom class for the toolbar container
  // Add more specific classes or attributes if needed
].join(', ') // Combine into a single selector string for `closest`

// --- Main Component ---
function TicketReplyBox({ ticket, onSuccess, onCancel }: Props) {
  const [isLoading, setIsLoading] = useState(false)
  const [content, setContent] = useState('<p></p>') // Start with empty paragraph for valid HTML
  const [from, setFrom] = useState<Contact | null>(null)
  const [to, setTo] = useState<Contact | null>(null)
  const [ccContacts, setCcContacts] = useState<Contact[]>([])
  const [showCc, setShowCc] = useState(false)
  const [showSubject, setShowSubject] = useState(false) // Assuming you have subject logic
  const [subject, setSubject] = useState(`Re: ${ticket.subject || 'Ticket ' + ticket.id}`) // Example subject state
  const [bccContacts, setBccContacts] = useState<Contact[]>([])
  const [showBcc, setShowBcc] = useState(false)
  const [attachmentIds, setAttachmentIds] = useState<string[]>([])
  const utils = api.useUtils()

  // Get the editor instance from the shared context
  const { editor } = useEditorContext()

  // --- Data Fetching & Mutations ---
  const { data: agents } = api.ticketAgent.getAvailableAgents.useQuery(undefined, {
    refetchOnWindowFocus: false,
  })

  const sendReply = api.ticket.createReply.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Reply sent', description: 'Your reply has been sent successfully.' })
      // Reset state after successful send
      setContent('<p></p>') // Reset editor content via state
      setAttachmentIds([])
      setCcContacts([])
      setBccContacts([])
      setShowCc(false)
      setShowBcc(false)
      // Optionally reset subject or update it based on conversation flow
      utils.ticket.byId.invalidate({ id: ticket.id }) // Refetch ticket data
      if (onSuccess) onSuccess()
    },
    onError: (error) => {
      toastError({ title: 'Error Sending Reply', description: error.message })
    },
    onSettled: () => {
      setIsLoading(false)
    },
  })
  // --- End Data Fetching & Mutations ---

  // --- Contact Logic ---
  const agentContacts: Contact[] = (agents || []).map((agent) => ({
    id: agent.id,
    name: agent.name ?? undefined,
    email: agent.email,
    type: 'agent',
  }))
  const customerContact: Contact = {
    id: ticket.contact.id.toString(),
    name: ticket.contact.firstName ?? undefined,
    email: ticket.contact?.email || '',
    type: 'customer',
  }
  const allContacts = [...agentContacts, customerContact]
  // TODO: change name
  const currentUserContact =
    agentContacts.find((contact) => contact.name === 'Markus') || agentContacts[0]

  // Set default From/To contacts on initial load
  useEffect(() => {
    if (currentUserContact && !from) setFrom(currentUserContact)
    if (customerContact && !to) setTo(customerContact)
  }, [currentUserContact, customerContact, from, to])
  // --- End Contact Logic ---

  // --- Event Handlers ---
  const handleSendReply = async () => {
    const trimmedContent = content.replace(/<p><\/p>$/, '').trim() // Check content more reliably
    if (!editor || !trimmedContent || !from || !to) {
      let message = 'Cannot send reply: '
      if (!editor) message += 'Editor not ready. '
      if (!trimmedContent) message += 'Content is empty. '
      if (!from) message += 'Sender (From) not selected. '
      if (!to) message += 'Recipient (To) not selected. '
      console.warn(message)
      toastError({
        title: 'Cannot Send',
        description: 'Please ensure content and recipients are set.',
      })
      return
    }
    setIsLoading(true)
    await sendReply.mutateAsync({
      ticketId: ticket.id,
      content: content, // Send the full HTML content from state
      subject: subject, // Include subject
      attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      fromEmail: from.email,
      toEmail: to.email,
      ccEmails: ccContacts.map((contact) => contact.email),
      bccEmails: bccContacts.map((contact) => contact.email),
    })
  }

  const addCcContact = (contact: Contact) => {
    if (!ccContacts.some((c) => c.id === contact.id)) setCcContacts([...ccContacts, contact])
  }
  const removeCcContact = (contactId: string) => {
    setCcContacts(ccContacts.filter((c) => c.id !== contactId))
  }
  const addBccContact = (contact: Contact) => {
    if (!bccContacts.some((c) => c.id === contact.id)) setBccContacts([...bccContacts, contact])
  }
  const removeBccContact = (contactId: string) => {
    setBccContacts(bccContacts.filter((c) => c.id !== contactId))
  }

  // Click handler for the main wrapper to focus the editor
  const handleWrapperClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!editor || editor.isDestroyed || editor.isFocused) {
      return // Do nothing if no editor, it's destroyed, or already focused
    }
    const target = event.target as Element
    // If the click target (or any of its parents) matches the interactive selectors, do nothing
    if (target.closest(INTERACTIVE_ELEMENT_SELECTORS)) {
      return
    }
    // Otherwise, focus the editor
    editor.commands.focus()
  }
  // --- End Event Handlers ---

  const uniqueId = useId() // For potential accessibility attributes if needed

  return (
    <div className='mx-auto w-full max-w-3xl rounded-2xl pb-4'>
      {/* Main wrapper with the onClick handler */}
      <div
        className='relative flex flex-col rounded-2xl border  border-black/10 bg-muted/60 transition-colors  focus-within:bg-muted [&:has(input:is(:disabled))_*]:pointer-events-none'
        onClick={handleWrapperClick} // Attach the focus handler here
      >
        {/* --- Header Fields (From, To, Cc, Bcc, Subject) --- */}
        <div className='flex flex-col border-b border-border'>
          {' '}
          {/* Group header fields */}
          {/* From field */}
          <div className='flex items-center gap-2 px-4 py-1'>
            <div className='w-10 text-sm text-muted-foreground'>From:</div>
            <Select
              value={from?.id}
              onValueChange={(value) => {
                const selectedContact = allContacts.find((c) => c.id === value)
                if (selectedContact) setFrom(selectedContact)
              }}>
              <SelectTrigger
                className='h-8 w-auto min-w-40 border-none bg-transparent focus:ring-0 flex-1'
                variant='transparent'>
                <SelectValue placeholder='Select sender'>
                  {from && (
                    <Badge variant='pill' className='m-[2px]'>
                      {from.name || from.email}
                    </Badge>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {agentContacts.map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contact.name} ({contact.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Separator className='mx-4 w-auto' /> {/* Use separator within the group */}
          {/* To field & Cc/Bcc/Subject Toggles */}
          <div className='flex items-center gap-2 px-4 py-1'>
            <div className='flex min-w-0 flex-1 items-center gap-2'>
              <span className='w-10 text-sm text-muted-foreground'>To:</span>
              <Select
                value={to?.id}
                onValueChange={(value) => {
                  const selectedContact = allContacts.find((c) => c.id === value)
                  if (selectedContact) setTo(selectedContact)
                }}>
                <SelectTrigger variant='transparent'>
                  <SelectValue placeholder='Select recipient'>
                    {to && (
                      <Badge variant='outline' className='m-[2px]'>
                        {to.name || to.email}
                      </Badge>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={customerContact.id}>
                    {customerContact.name || 'Customer'} ({customerContact.email})
                  </SelectItem>
                  {agentContacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.name} ({contact.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='ml-auto flex shrink-0 items-center gap-1'>
              {' '}
              {/* Prevent buttons from wrapping */}
              {!showSubject && (
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-6 px-1 text-xs text-info'
                  onClick={() => setShowSubject(true)}>
                  Subject
                </Button>
              )}
              {!showCc && (
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-6 px-1 text-xs text-info'
                  onClick={() => setShowCc(true)}>
                  Cc
                </Button>
              )}
              {!showBcc && (
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-6 px-1 text-xs text-info'
                  onClick={() => setShowBcc(true)}>
                  Bcc
                </Button>
              )}
            </div>
          </div>
          {/* CC field */}
          {showCc && (
            <>
              <Separator className='mx-4 w-auto' />
              <div className='flex items-center gap-2 px-4 py-2'>
                <span className='w-10 text-sm text-muted-foreground'>Cc:</span>
                <div className='flex min-w-0 flex-1 flex-wrap items-center gap-1'>
                  {/* ... CC Badges ... */}
                  {ccContacts.map((contact) => (
                    <Badge key={contact.id} variant='outline' className='flex items-center gap-1'>
                      {contact.name || contact.email}
                      <button onClick={() => removeCcContact(contact.id)}>
                        <X className='size-3' />
                      </button>
                    </Badge>
                  ))}
                  {/* ... CC Popover Trigger ... */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant='ghost' size='sm' className='h-6 px-2'>
                        <Plus className='size-3 text-muted-foreground' />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='p-0' align='start' side='bottom'>
                      <Command>
                        <CommandInput placeholder='Search for contact...' />
                        <CommandList>
                          <CommandEmpty>No contacts found.</CommandEmpty>
                          <CommandGroup>
                            {allContacts
                              .filter((contact) => !ccContacts.some((c) => c.id === contact.id))
                              .filter((contact) => from?.id !== contact.id && to?.id !== contact.id)
                              .map((contact) => (
                                <CommandItem
                                  key={contact.id}
                                  value={contact.id}
                                  onSelect={() => addCcContact(contact)}>
                                  {contact.name || contact.email}
                                  <span className='ml-2 text-xs text-muted-foreground'>
                                    {contact.email}
                                  </span>
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {ccContacts.length > 0 /* Show remove only if there are contacts */ && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='ml-auto h-6 px-1 text-xs text-muted-foreground'
                      onClick={() => setShowCc(false)}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
          {/* BCC field */}
          {showBcc && (
            <>
              <Separator className='mx-4 w-auto' />
              <div className='flex items-center gap-2 px-4 py-2'>
                <span className='w-10 text-sm text-muted-foreground'>Bcc:</span>
                <div className='flex min-w-0 flex-1 flex-wrap items-center gap-1 p-0.5'>
                  {bccContacts.map((contact) => (
                    <Badge key={contact.id} variant='outline' className='flex items-center gap-1'>
                      {contact.name || contact.email}
                      <button onClick={() => removeBccContact(contact.id)}>
                        <X className='size-3' />
                      </button>
                    </Badge>
                  ))}

                  {/* ... BCC Popover Trigger ... */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant='ghost' size='sm' className='h-6 px-2'>
                        <Plus className='size-3 text-muted-foreground' />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='p-0' align='start' side='bottom'>
                      <Command>
                        <CommandInput placeholder='Search for contact...' />
                        <CommandList>
                          <CommandEmpty>No contacts found.</CommandEmpty>
                          <CommandGroup>
                            {allContacts
                              .filter((contact) => !bccContacts.some((c) => c.id === contact.id))
                              .filter((contact) => from?.id !== contact.id && to?.id !== contact.id)
                              .map((contact) => (
                                <CommandItem
                                  key={contact.id}
                                  value={contact.id}
                                  onSelect={() => addBccContact(contact)}>
                                  {contact.name || contact.email}
                                  <span className='ml-2 text-xs text-muted-foreground'>
                                    {contact.email}
                                  </span>
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {bccContacts.length > 0 && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='ml-auto h-6 px-1 text-xs text-muted-foreground'
                      onClick={() => setShowBcc(false)}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
          {/* Subject field */}
          {showSubject && (
            <>
              <Separator />
              <div className='flex items-center gap-2 px-4 py-2'>
                <span className='text-sm text-muted-foreground/70'>Subject:</span>
                <div className='flex flex-1 flex-wrap gap-2'>
                  <input type='text' className='w-full bg-transparent outline-hidden' />
                </div>
                {showSubject && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='ml-auto h-6 text-xs text-muted-foreground'
                    onClick={() => setShowSubject(false)}>
                    Remove
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        <div className='min-h-[150px]'>
          {' '}
          {/* Add wrapper to enforce min-height visually if editorProps doesn't suffice */}
          <TiptapEditor
            content={content}
            onChange={setContent}
            placeholder='Type your reply here...'
          />
        </div>
        <div className='editor-toolbar-wrapper flex items-center gap-1 overflow-x-auto border-t border-border px-2 py-1 md:gap-2 md:px-4 md:py-2'>
          {/* Pass editor instance from context to the toolbar */}
          <EditorToolbar editor={editor} />
        </div>
      </div>
    </div>
  )
}

// Wrap the component with the EditorProvider for context availability
const TicketReplyBoxWithProvider = (props: Props) => (
  <EditorProvider>
    <TicketReplyBox {...props} />
  </EditorProvider>
)

export default TicketReplyBoxWithProvider
