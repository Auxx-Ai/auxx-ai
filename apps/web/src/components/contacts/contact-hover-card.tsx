// apps/web/src/components/contacts/contact-hover-card.tsx

'use client'

import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card } from '@auxx/ui/components/card'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { getFullName, getInitials } from '@auxx/utils'
import { CalendarIcon, ExternalLinkIcon, MailIcon, PhoneIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'

// Define the Contact type based on your schema
type Contact = {
  id: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  emails: string[]
  phone?: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'SPAM' | 'MERGED'
  tags?: string[]
  notes?: string | null
  createdAt: Date
  // You can add more fields if needed
}

interface ContactHoverCardProps {
  contactId?: string
  contact?: Contact
  children: ReactNode
  className?: string
  showFooterActions?: boolean
}

export function ContactHoverCard({
  contactId,
  contact: initialContact,
  children,
  className,
  showFooterActions = true,
}: ContactHoverCardProps) {
  const [contact, setContact] = useState<Contact | null>(initialContact || null)
  const [loading, setLoading] = useState(!initialContact && !!contactId)

  // Only fetch the contact data if a contactId is provided and no initial contact
  const { data: fetchedContact } = api.contact.getById.useQuery(
    { id: contactId as string },
    { enabled: !initialContact && !!contactId }
  )
  // Update contact if fetchedContact changes
  useEffect(() => {
    if (fetchedContact) {
      setContact(fetchedContact)
      setLoading(false)
    }
  }, [fetchedContact])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className={cn('cursor-pointer', className)}>{children}</div>
      </PopoverTrigger>
      <PopoverContent className='w-60 p-1.5' onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <div className='flex h-32 items-center justify-center'>
            <div className='h-4 w-24 animate-pulse rounded bg-gray-200'></div>
          </div>
        ) : contact ? (
          <div className='space-y-1'>
            <div className='flex items-start gap-3'>
              <Avatar className='size-8 border'>
                <AvatarFallback className='text-xs'>{getInitials(contact)}</AvatarFallback>
              </Avatar>
              <div className='space-y-1 mt-0'>
                <h4 className='text-sm font-semibold'>{getFullName(contact)}</h4>
                {contact.email && (
                  <div className='flex items-center text-xs text-muted-foreground'>
                    <MailIcon className='mr-1 size-3' />
                    <span>{contact.email}</span>
                  </div>
                )}
                {contact.phone && (
                  <div className='flex items-center text-xs text-muted-foreground'>
                    <PhoneIcon className='mr-1 size-3' />
                    <span>{contact.phone}</span>
                  </div>
                )}
                <div className='flex items-center text-xs text-muted-foreground'>
                  <CalendarIcon className='mr-1 size-3' />
                  <span>Contact since {new Date(contact.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>

            {contact.tags && contact.tags.length > 0 && (
              <div className='flex flex-wrap gap-1'>
                {contact.tags.map((tag) => (
                  <Badge key={tag} variant='secondary' className='text-xs'>
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {contact.notes && (
              <Card className='p-2 text-xs'>
                <p className='line-clamp-3'>{contact.notes}</p>
              </Card>
            )}

            {showFooterActions && (
              <div className='flex justify-end gap-2 text-xs'>
                <Button
                  asChild
                  size='sm'
                  variant='link'
                  className='flex items-center text-info hover:bg-accent'>
                  <Link href={`/app/contacts/${contact.id}`}>
                    <span>View Profile</span>
                    <ExternalLinkIcon className='ml-1 size-3' />
                  </Link>
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className='p-4 text-center text-muted-foreground'>Contact not found</div>
        )}
      </PopoverContent>
    </Popover>
  )
}
