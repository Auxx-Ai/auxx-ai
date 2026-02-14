// apps/web/src/app/(protected)/app/tickets/settings/templates/_components/template-variables-popover.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContentDialogAware, PopoverTrigger } from '@auxx/ui/components/popover'
import { ChevronDownIcon, ChevronsUpDownIcon, HashIcon } from 'lucide-react'
import React, { useMemo, useState } from 'react'

interface VariableGroup {
  name: string
  items: { id: string; label: string; value: string; description?: string }[]
}

interface TemplateVariablesPopoverProps {
  templateType: string
  onInsert: (placeholder: string) => void
}

/** Get variable groups based on template type */
const getVariableGroups = (templateType: string): VariableGroup[] => {
  const baseGroups: VariableGroup[] = [
    {
      name: 'Ticket',
      items: [
        {
          id: 'ticket-number',
          label: 'Number',
          value: '{{ticket.number}}',
          description: 'The ticket number (e.g., TKT-123456)',
        },
        {
          id: 'ticket-title',
          label: 'Title',
          value: '{{ticket.title}}',
          description: 'The subject/title of the ticket',
        },
        {
          id: 'ticket-status',
          label: 'Status',
          value: '{{ticket.status}}',
          description: 'Current status (e.g., OPEN, CLOSED)',
        },
        {
          id: 'ticket-created',
          label: 'Created At',
          value: '{{ticket.createdAt}}',
          description: 'When the ticket was created',
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
          description: "The customer's name",
        },
        {
          id: 'customer-email',
          label: 'Email',
          value: '{{customer.email}}',
          description: "The customer's email address",
        },
      ],
    },
    {
      name: 'Organization',
      items: [
        {
          id: 'org-name',
          label: 'Name',
          value: '{{organization.name}}',
          description: 'Your organization/company name',
        },
      ],
    },
  ]

  // Add type-specific variables
  switch (templateType) {
    case 'TICKET_REPLIED':
      return [
        ...baseGroups,
        {
          name: 'Reply',
          items: [
            {
              id: 'reply-content',
              label: 'Content (HTML)',
              value: '{{reply.content}}',
              description: 'The HTML content of the reply',
            },
            {
              id: 'reply-plain',
              label: 'Content (Plain)',
              value: '{{reply.contentPlain}}',
              description: 'The plain text content',
            },
            {
              id: 'agent-name',
              label: 'Agent Name',
              value: '{{agent.name}}',
              description: 'The agent who replied',
            },
          ],
        },
      ]

    case 'TICKET_CLOSED':
      baseGroups[0].items.push({
        id: 'ticket-closed',
        label: 'Closed At',
        value: '{{ticket.closedAt}}',
        description: 'When the ticket was closed',
      })
      return baseGroups

    case 'TICKET_ASSIGNED':
      return [
        ...baseGroups,
        {
          name: 'Assignee',
          items: [
            {
              id: 'assignee-name',
              label: 'Name',
              value: '{{assignee.name}}',
              description: 'The assigned agent',
            },
            {
              id: 'assignee-email',
              label: 'Email',
              value: '{{assignee.email}}',
              description: "Agent's email",
            },
          ],
        },
      ]

    case 'TICKET_STATUS_CHANGED':
      return [
        ...baseGroups,
        {
          name: 'Status Change',
          items: [
            {
              id: 'status-old',
              label: 'Old Status',
              value: '{{statusChange.oldStatus}}',
              description: 'Previous status',
            },
            {
              id: 'status-new',
              label: 'New Status',
              value: '{{statusChange.newStatus}}',
              description: 'New status',
            },
            {
              id: 'status-reason',
              label: 'Reason',
              value: '{{statusChange.reason}}',
              description: 'Reason for change',
            },
          ],
        },
      ]

    default:
      return baseGroups
  }
}

/** Popover component for inserting template variables */
export function TemplateVariablesPopover({
  templateType,
  onInsert,
}: TemplateVariablesPopoverProps) {
  const [open, setOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const variableGroups = useMemo(() => getVariableGroups(templateType), [templateType])

  /** Filter variables based on search term and selected group */
  const filteredGroups = useMemo(() => {
    let result = [...variableGroups]

    if (selectedGroup) {
      result = result.filter((group) => group.name === selectedGroup)
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      result = result
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) =>
              item.label.toLowerCase().includes(term) ||
              item.description?.toLowerCase().includes(term) ||
              item.value.toLowerCase().includes(term)
          ),
        }))
        .filter((group) => group.items.length > 0)
    }

    return result
  }, [variableGroups, selectedGroup, searchTerm])

  /** Handle inserting a variable */
  const handleInsert = (value: string) => {
    onInsert(value)
    setOpen(false)
    setSearchTerm('')
    setSelectedGroup(null)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='outline' size='sm' className='h-8 gap-1 text-xs'>
          <HashIcon size={14} />
          Insert Variable
          <ChevronDownIcon size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContentDialogAware className='w-80 p-0' align='end'>
        <Command>
          <div className='flex items-center border-b px-3'>
            <CommandInput
              placeholder='Search variables...'
              value={searchTerm}
              onValueChange={setSearchTerm}
              className='h-9'
            />
            {selectedGroup && (
              <Button
                variant='ghost'
                size='icon'
                className='h-9 w-9'
                onClick={() => setSelectedGroup(null)}>
                <ChevronDownIcon size={14} />
              </Button>
            )}
          </div>

          {!selectedGroup && !searchTerm && (
            <div className='border-b p-2'>
              <div className='px-2 py-1 text-xs font-medium text-muted-foreground'>
                SELECT CATEGORY
              </div>
              <div className='grid grid-cols-2 gap-1'>
                {variableGroups.map((group) => (
                  <Button
                    key={group.name}
                    variant='ghost'
                    size='sm'
                    className='justify-start font-normal'
                    onClick={() => setSelectedGroup(group.name)}>
                    {group.name}
                    <ChevronsUpDownIcon size={14} className='ml-auto opacity-70' />
                  </Button>
                ))}
              </div>
            </div>
          )}

          <CommandList>
            <CommandEmpty>No variables found.</CommandEmpty>
            {filteredGroups.map((group) => (
              <CommandGroup key={group.name} heading={group.name}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    onSelect={() => handleInsert(item.value)}
                    className='flex flex-col items-start gap-0.5'>
                    <div className='flex w-full items-center'>
                      <span>{item.label}</span>
                    </div>
                    {item.description && (
                      <span className='text-xs text-muted-foreground'>{item.description}</span>
                    )}
                    <span className='font-mono text-xs text-blue-500 dark:text-blue-400'>
                      {item.value}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContentDialogAware>
    </Popover>
  )
}
