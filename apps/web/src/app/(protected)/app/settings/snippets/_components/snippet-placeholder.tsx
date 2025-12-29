// components/snippets/SnippetPlaceholder.tsx
import React from 'react'
import { CheckIcon, ChevronDownIcon, ChevronsUpDownIcon, HashIcon } from 'lucide-react'
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
import { cn } from '@auxx/ui/lib/utils'

interface PlaceholderGroup {
  name: string
  items: { id: string; label: string; value: string; description?: string }[]
}

interface SnippetPlaceholderProps {
  onInsert: (placeholder: string) => void
}

export function SnippetPlaceholder({ onInsert }: SnippetPlaceholderProps) {
  const [open, setOpen] = React.useState(false)
  const [selectedGroup, setSelectedGroup] = React.useState<string | null>(null)
  const [searchTerm, setSearchTerm] = React.useState('')

  // Define placeholder groups
  const placeholderGroups: PlaceholderGroup[] = [
    {
      name: 'Organization',
      items: [
        {
          id: 'org-name',
          label: 'Name',
          value: '{{organization.name}}',
          description: 'The name of the organization',
        },
        {
          id: 'org-email',
          label: 'Email',
          value: '{{organization.email}}',
          description: 'The email of the organization',
        },
        {
          id: 'org-website',
          label: 'Website',
          value: '{{organization.website}}',
          description: 'The website of the organization',
        },
        {
          id: 'org-about',
          label: 'About',
          value: '{{organization.about}}',
          description: 'About the organization',
        },
      ],
    },
    {
      name: 'Agent',
      items: [
        { id: 'agent-name', label: 'Name', value: '{{agent.name}}', description: 'Your name' },
        {
          id: 'agent-email',
          label: 'Email',
          value: '{{agent.email}}',
          description: 'Your email address',
        },
        {
          id: 'agent-role',
          label: 'Role',
          value: '{{agent.role}}',
          description: 'Your role in the organization',
        },
      ],
    },
    {
      name: 'Ticket',
      items: [
        {
          id: 'ticket-number',
          label: 'Number',
          value: '{{ticket.number}}',
          description: 'The ticket number',
        },
        {
          id: 'ticket-title',
          label: 'Title',
          value: '{{ticket.title}}',
          description: 'The title of the ticket',
        },
        {
          id: 'ticket-status',
          label: 'Status',
          value: '{{ticket.status}}',
          description: 'The current status of the ticket',
        },
        {
          id: 'ticket-priority',
          label: 'Priority',
          value: '{{ticket.priority}}',
          description: 'The priority of the ticket',
        },
        {
          id: 'ticket-type',
          label: 'Type',
          value: '{{ticket.type}}',
          description: 'The type of the ticket',
        },
        {
          id: 'ticket-created-date',
          label: 'Created Date',
          value: '{{ticket.createdAt}}',
          description: 'The date the ticket was created',
        },
        {
          id: 'ticket-updated-date',
          label: 'Updated Date',
          value: '{{ticket.updatedAt}}',
          description: 'The date the ticket was last updated',
        },
        {
          id: 'ticket-due-date',
          label: 'Due Date',
          value: '{{ticket.dueDate}}',
          description: 'The due date of the ticket',
        },
      ],
    },
    {
      name: 'Customer',
      items: [
        {
          id: 'customer-name',
          label: 'Name',
          value: '{{customer.name}}',
          description: "The customer's full name",
        },
        {
          id: 'customer-first-name',
          label: 'First Name',
          value: '{{customer.firstName}}',
          description: "The customer's first name",
        },
        {
          id: 'customer-last-name',
          label: 'Last Name',
          value: '{{customer.lastName}}',
          description: "The customer's last name",
        },
        {
          id: 'customer-email',
          label: 'Email',
          value: '{{customer.email}}',
          description: "The customer's email address",
        },
        {
          id: 'customer-phone',
          label: 'Phone',
          value: '{{customer.phone}}',
          description: "The customer's phone number",
        },
      ],
    },
    {
      name: 'Date & Time',
      items: [
        { id: 'date-today', label: 'Today', value: '{{date.today}}', description: 'Current date' },
        {
          id: 'date-now',
          label: 'Now',
          value: '{{date.now}}',
          description: 'Current date and time',
        },
        {
          id: 'date-tomorrow',
          label: 'Tomorrow',
          value: '{{date.tomorrow}}',
          description: "Tomorrow's date",
        },
        {
          id: 'date-yesterday',
          label: 'Yesterday',
          value: '{{date.yesterday}}',
          description: "Yesterday's date",
        },
      ],
    },
    {
      name: 'Order',
      items: [
        {
          id: 'order-number',
          label: 'Number',
          value: '{{order.number}}',
          description: 'The order number',
        },
        { id: 'order-date', label: 'Date', value: '{{order.date}}', description: 'The order date' },
        {
          id: 'order-status',
          label: 'Status',
          value: '{{order.status}}',
          description: 'The order status',
        },
        {
          id: 'order-total',
          label: 'Total',
          value: '{{order.total}}',
          description: 'The order total',
        },
      ],
    },
  ]

  // Filter placeholders based on search term and selected group
  const filteredPlaceholders = React.useMemo(() => {
    let result: PlaceholderGroup[] = [...placeholderGroups]

    // Filter by selected group
    if (selectedGroup) {
      result = result.filter((group) => group.name === selectedGroup)
    }

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      result = result
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) =>
              item.label.toLowerCase().includes(term) ||
              item.description?.toLowerCase().includes(term)
          ),
        }))
        .filter((group) => group.items.length > 0)
    }

    return result
  }, [placeholderGroups, selectedGroup, searchTerm])

  // Handle insert
  const handleInsert = (value: string) => {
    onInsert(value)
    setOpen(false)
    setSearchTerm('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
          <HashIcon size={14} />
          Insert Placeholder
          <ChevronDownIcon size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <div className="flex items-center border-b px-3">
            <CommandInput
              placeholder="Search placeholders..."
              value={searchTerm}
              onValueChange={setSearchTerm}
              className="h-9"
            />
            {selectedGroup && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setSelectedGroup(null)}>
                <ChevronDownIcon size={14} />
              </Button>
            )}
          </div>

          {!selectedGroup && !searchTerm && (
            <div className="border-b p-2">
              <div className="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                SELECT CATEGORY
              </div>
              <div className="grid grid-cols-2 gap-1">
                {placeholderGroups.map((group) => (
                  <Button
                    key={group.name}
                    variant="ghost"
                    size="sm"
                    className="justify-start font-normal"
                    onClick={() => setSelectedGroup(group.name)}>
                    {group.name}
                    <ChevronsUpDownIcon size={14} className="ml-auto opacity-70" />
                  </Button>
                ))}
              </div>
            </div>
          )}

          <CommandList>
            <CommandEmpty>No placeholders found.</CommandEmpty>
            {filteredPlaceholders.map((group) => (
              <CommandGroup key={group.name} heading={group.name}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    onSelect={() => handleInsert(item.value)}
                    className="flex flex-col items-start rounded-2xl space-y-0 gap-0.5">
                    <div className="flex w-full items-center">
                      <span>{item.label}</span>
                      <CheckIcon className={cn('ml-auto size-4', 'opacity-0')} />
                    </div>
                    {item.description && (
                      <span className=" text-xs text-gray-500 dark:text-gray-400">
                        {item.description}
                      </span>
                    )}
                    <span className=" font-mono text-xs text-blue-500 dark:text-blue-400">
                      {item.value}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
