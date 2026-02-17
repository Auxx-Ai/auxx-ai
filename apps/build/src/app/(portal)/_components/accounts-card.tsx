// apps/build/src/app/(portal)/_components/accounts-card.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { Building } from 'lucide-react'
import Link from 'next/link'
import { useDeveloperAccounts } from '~/components/providers/dehydrated-state-provider'

/**
 * Developer accounts list card
 * Uses dehydrated state for instant loading
 */
export function AccountsCard() {
  const accounts = useDeveloperAccounts()

  return (
    <div className='flex items-center flex-col flex-1 min-h-0 h-full'>
      <div className='mx-auto min-w-md max-w-xl p-6 space-y-3'>
        <Card className='shadow-md shadow-black/20 border-transparent'>
          <CardHeader className='text-center'>
            {accounts.length > 0 && (
              <>
                <CardTitle className='text-lg'>Developer accounts</CardTitle>
                <CardDescription>
                  Jump into an existing developer account or add a new one
                </CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent className=''>
            <div className='w-full max-w-md'>
              {accounts.length > 0 ? (
                accounts.map((account) => (
                  <Link key={account.id} href={`/${account.slug}`}>
                    <div className='group flex items-center justify-between rounded-2xl border mb-2 py-2 px-3 hover:bg-muted transition-colors duration-200'>
                      <div className='flex flex-row items-center gap-2'>
                        <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0'>
                          {account.logoUrl ? (
                            <img
                              src={account.logoUrl}
                              alt={account.title}
                              className='size-full object-cover rounded-lg'
                            />
                          ) : (
                            <Building className='size-4' />
                          )}
                        </div>
                        <div className='flex flex-col'>
                          <div className='flex items-center gap-2'>
                            <span className='text-sm'>{account.title}</span>
                            {account.userMember.accessLevel === 'admin' && (
                              <span className='text-xs text-muted-foreground'>(Admin)</span>
                            )}
                          </div>
                          <span className='text-xs text-muted-foreground'>/{account.slug}</span>
                        </div>
                      </div>
                      <div className='flex items-center gap-2'></div>
                    </div>
                  </Link>
                ))
              ) : (
                <Empty className='border-0'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <Building />
                    </EmptyMedia>
                    <EmptyTitle>No developer accounts yet</EmptyTitle>
                    <EmptyDescription>Create your first one below to get started!</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </CardContent>
        </Card>

        <div className='flex items-center justify-between w-full'>
          <Button className='w-full' asChild>
            <Link href='/new'>Create new development account</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
