// apps/web/src/app/(protected)/app/contacts/_components/contact-columns.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@auxx/ui/components/dropdown-menu'
import {
  User,
  Mail,
  Smartphone,
  Database,
  Tag,
  Calendar,
  Users,
  PanelRight,
  Merge,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { FormattedCell, PrimaryCell } from '~/components/dynamic-table'
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
 * Create table columns for the contacts list
 * Uses PrimaryCell component with integrated actions
 */
export function createContactColumns(actions: ContactColumnActions): ExtendedColumnDef<Contact>[] {
  return [
    {
      accessorFn: (row) =>
        `${row.firstName || ''} ${row.lastName || ''}`.trim() || 'Unnamed Customer',
      id: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const displayName =
          `${row.original.firstName || ''} ${row.original.lastName || ''}`.trim() ||
          'Unnamed Customer'
        return (
          <PrimaryCell
            value={displayName}
            onTitleClick={() => actions.onViewDetails(row.original.id)}>
            <DropdownMenuItem onClick={() => actions.onViewDetails(row.original.id)}>
              <PanelRight />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onManageGroups(row.original.id)}>
              <Users />
              Manage Groups
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onMerge(row.original.id)}>
              <Merge />
              Merge With Another
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => actions.onMarkAsSpam(row.original.id)}>
              <ShieldAlert />
              Mark as Spam
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete(row.original.id)}>
              <Trash2 />
              Delete Contact
            </DropdownMenuItem>
          </PrimaryCell>
        )
      },
      enableSorting: true,
      primaryCell: true,
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
