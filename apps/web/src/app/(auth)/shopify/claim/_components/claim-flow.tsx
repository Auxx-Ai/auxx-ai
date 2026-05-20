// apps/web/src/app/(auth)/shopify/claim/_components/claim-flow.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { toastError } from '@auxx/ui/components/toast'
import { Building, Store } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

interface ClaimFlowProps {
  shop: string
  orgs: { id: string; name: string | null; handle: string | null }[]
  defaultOrganizationId: string | null
  claimToken: string
}

/**
 * Org picker for an App-Store-initiated install. The shop's access token is
 * parked in Redis; clicking a card finalizes the install against that org.
 */
export function ClaimFlow({ shop, orgs, defaultOrganizationId, claimToken }: ClaimFlowProps) {
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null)

  const finalize = api.shopify.finalizeAppStoreInstall.useMutation({
    onSuccess: ({ redirectUrl }) => {
      window.location.href = redirectUrl
    },
    onError: (error) => {
      toastError({
        title: 'Failed to connect Shopify',
        description: error.message,
      })
      setPendingOrgId(null)
    },
  })

  const handleSelect = (organizationId: string) => {
    setPendingOrgId(organizationId)
    finalize.mutate({ organizationId, claimToken })
  }

  return (
    <div className='flex min-h-[calc(100vh-8rem)] w-screen items-center justify-center p-4'>
      <div className='flex w-full max-w-md flex-col items-center space-y-5 px-6'>
        <Card variant='translucent' className='w-full shadow-md shadow-black/20 border-transparent'>
          <CardHeader className='text-center'>
            <div className='mx-auto mb-5 size-14 border flex items-center justify-center rounded-2xl bg-muted'>
              <Store className='size-8 text-info' />
            </div>
            <CardTitle className='text-white'>
              Connect <span className='font-mono text-base'>{shop}</span> to Auxx
            </CardTitle>
            <CardDescription>Choose the workspace this shop belongs to.</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col'>
            <div className='space-y-3'>
              {orgs.length > 0 ? (
                orgs.map((org) => (
                  <button
                    type='button'
                    key={org.id}
                    onClick={() => handleSelect(org.id)}
                    disabled={!!pendingOrgId}
                    className='group flex w-full cursor-pointer hover:bg-muted/10 items-center justify-between rounded-2xl border-0 ring-1 ring-white/20 py-2 px-3 transition-colors duration-200 disabled:opacity-50'>
                    <div className='flex flex-row items-center gap-2'>
                      <div className='size-8 border bg-muted/10 border-white/10 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-muted/20'>
                        <Building className='size-4' />
                      </div>
                      <div className='flex flex-col items-start'>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm'>
                            {org.name || `Organization ${org.id.substring(0, 6)}`}
                          </span>
                          {org.id === defaultOrganizationId && (
                            <Badge size='xs' variant='default'>
                              Current
                            </Badge>
                          )}
                        </div>
                        <span className='text-xs text-white/50'>
                          {org.handle || `@${org.id.substring(0, 8)}`}
                        </span>
                      </div>
                    </div>
                    {pendingOrgId === org.id && (
                      <span className='text-xs text-white/60'>Connecting…</span>
                    )}
                  </button>
                ))
              ) : (
                <p className='text-center text-sm text-white/50 py-4'>
                  You are not a member of any workspace yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
