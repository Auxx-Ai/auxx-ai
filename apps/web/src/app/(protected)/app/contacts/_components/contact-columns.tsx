// apps/web/src/app/(protected)/app/contacts/_components/contact-columns.tsx

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
import {
  User,
  Mail,
  Smartphone,
  Database,
  Tag,
  Calendar,
  Users,
  MoreVertical,
  PanelRight,
  Merge,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { FormattedCell } from '~/components/dynamic-table'
import { getCustomerStatusVariant } from '~/components/contacts/contact-status'
import { type CustomerStatus } from '@auxx/database/types'

/**
 * Contact type to match the data structure from the API
 */
export type Contact = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  createdAt: string
  updatedAt: string
  phone: string | null
  status: CustomerStatus
  customerSources: {
    id: string
    source: string
  }[]
  customerGroups: {
    customerGroupId: string
    customerGroup: {
      name: string
    }
  }[]
  customFieldValues?: Array<{
    fieldId: string
    value: any
  }>
}

/**
 * Interface for actions that can be performed on contacts
 */
export interface ContactColumnActions {
  onViewDetails: (id: string) => void
  onManageGroups: (id: string) => void
  onMerge: (id: string) => void
  onMarkAsSpam: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * Props for ContactNameCell component
 */
interface ContactNameCellProps {
  contact: Contact
  onViewDetails: (id: string) => void
  onManageGroups: (id: string) => void
  onMerge: (id: string) => void
  onMarkAsSpam: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * Contact name cell component with integrated actions
 * Shows the contact name as clickable link and actions dropdown on hover
 * Handles its own padding for proper table cell layout
 */
function ContactNameCell({
  contact,
  onViewDetails,
  onManageGroups,
  onMerge,
  onMarkAsSpam,
  onDelete,
}: ContactNameCellProps) {
  const displayName =
    `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unnamed Customer'

  return (
    <div className="flex items-center justify-between w-full pl-3 pr-2 text-sm group/name">
      <button
        className="text-left underline decoration-muted-foreground/50 hover:decoration-primary truncate max-w-[calc(100%-40px)] font-medium"
        onClick={(e) => {
          e.stopPropagation()
          onViewDetails(contact.id)
        }}>
        {displayName}
      </button>

      <div onClick={(e) => e.stopPropagation()} className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-6 p-0 opacity-0 group-hover/name:opacity-100 transition-opacity data-[state=open]:opacity-100!">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onViewDetails(contact.id)}>
              <PanelRight />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onManageGroups(contact.id)}>
              <Users />
              Manage Groups
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMerge(contact.id)}>
              <Merge />
              Merge With Another
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onMarkAsSpam(contact.id)}>
              <ShieldAlert />
              Mark as Spam
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(contact.id)}>
              <Trash2 />
              Delete Contact
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/**
 * Create table columns for the contacts list
 * Uses ContactNameCell component with integrated actions
 */
export function createContactColumns(actions: ContactColumnActions): ExtendedColumnDef<Contact>[] {
  return [
    {
      accessorFn: (row) =>
        `${row.firstName || ''} ${row.lastName || ''}`.trim() || 'Unnamed Customer',
      id: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <ContactNameCell
          contact={row.original}
          onViewDetails={actions.onViewDetails}
          onManageGroups={actions.onManageGroups}
          onMerge={actions.onMerge}
          onMarkAsSpam={actions.onMarkAsSpam}
          onDelete={actions.onDelete}
        />
      ),
      enableSorting: true,
      defaultPinned: true,
      enableResizing: true,
      enableHiding: false,
      minSize: 200,
      maxSize: 400,
      size: 300,
      columnType: 'text',
      icon: User,
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ getValue }) => (
        <FormattedCell value={getValue()} fieldType="EMAIL" columnId="email" />
      ),
      enableSorting: true,
      enableResizing: true,
      minSize: 100,
      maxSize: 300,
      columnType: 'email',
      fieldType: 'EMAIL',
      icon: Mail,
    },
    {
      accessorKey: 'phone',
      header: 'Phone',
      cell: ({ getValue }) => {
        const value = getValue()
        // Normalize empty object or string '{}' to null
        const isEmpty =
          value === '{}' ||
          (typeof value === 'object' && value !== null && Object.keys(value).length === 0)
        return <FormattedCell value={isEmpty ? null : value} fieldType="PHONE" columnId="phone" />
      },
      enableSorting: true,
      enableResizing: true,
      size: 150,
      columnType: 'phone',
      fieldType: 'PHONE',
      icon: Smartphone,
    },
    {
      accessorKey: 'sources',
      header: 'Sources',
      cell: ({ row }) => (
        <FormattedCell
          value={null}
          fieldType="ITEMS"
          columnId="sources"
          items={row.original.customerSources}
          renderItem={(source: { id: string; source: string }) => (
            <Badge variant="gray" size="sm">
              {source.source}
            </Badge>
          )}
        />
      ),
      enableSorting: true,
      enableResizing: true,
      size: 150,
      columnType: 'text',
      icon: Database,
    },
    {
      id: 'groups',
      header: 'Groups',
      cell: ({ row }) => (
        <FormattedCell
          value={null}
          fieldType="ITEMS"
          columnId="groups"
          items={row.original.customerGroups.map((g) => ({
            id: g.customerGroupId,
            name: g.customerGroup.name,
          }))}
          renderItem={(group: { id: string; name: string }) => (
            <Badge variant="pill" shape="tag">
              {group.name}
            </Badge>
          )}
        />
      ),
      enableSorting: true,
      enableResizing: true,
      size: 150,
      columnType: 'text',
      icon: Users,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.original.status
        const variant = getCustomerStatusVariant(status)
        return (
          <FormattedCell
            value={null}
            fieldType="ITEMS"
            columnId="status"
            items={[{ id: status }]}
            renderItem={(item: { id: string }) => <Badge variant={variant}>{item.id}</Badge>}
          />
        )
      },
      enableSorting: true,
      enableResizing: true,
      size: 100,
      columnType: 'text',
      icon: Tag,
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ getValue }) => (
        <FormattedCell value={getValue()} fieldType="DATE" columnId="createdAt" />
      ),
      enableSorting: true,
      enableResizing: true,
      size: 150,
      columnType: 'date',
      fieldType: 'DATE',
      icon: Calendar,
    },
  ]
}
