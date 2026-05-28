// apps/web/src/app/(auth)/shopify/claim/_components/claim-flow.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
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
 * Workspace picker for an App-Store-initiated install. Under Shopify App Pricing the
 * plan picker lives on Shopify's hosted page, so this flow only chooses which Auxx
 * workspace the shop attaches to (a shop can belong to more than one). Clicking
 * "Continue to plan selection" finalizes the install and browser-redirects to Shopify's
 * pricing page; the merchant picks + approves there and returns to
 * `/billing/subscription/activated`.
 */
export function ClaimFlow({ shop, orgs, defaultOrganizationId, claimToken }: ClaimFlowProps) {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(
    defaultOrganizationId ?? orgs[0]?.id ?? null
  )

  const finalize = api.shopify.finalizeAppStoreInstall.useMutation({
    onSuccess: ({ redirectUrl }) => {
      window.location.href = redirectUrl
    },
    onError: (error) => {
      toastError({
        title: 'Failed to connect Shopify',
        description: error.message,
      })
    },
  })

  const handleFinalize = () => {
    if (!selectedOrgId) return
    finalize.mutate({ organizationId: selectedOrgId, claimToken })
  }

  const finalizeDisabled = !selectedOrgId || finalize.isPending || orgs.length === 0

  return (
    <div className='h-screen w-screen overflow-y-auto'>
      <div className='flex min-h-full w-full items-center justify-center p-4'>
        <div className='flex w-full max-w-md flex-col items-center space-y-5 sm:px-6'>
          <Card
            variant='translucent'
            className='w-full shadow-md shadow-black/20 border-transparent '>
            <CardHeader className='text-center'>
              <div className='mx-auto mb-5 size-14 border flex items-center justify-center rounded-2xl bg-muted'>
                <Store className='size-8 text-info' />
              </div>
              <CardTitle className='text-white'>
                Connect <span className='font-mono text-base'>{shop}</span> to Auxx
              </CardTitle>
              <CardDescription>
                Choose the workspace for this shop. You'll pick a plan on Shopify next.
              </CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-6'>
              {/* Workspace picker */}
              <div className='space-y-2'>
                <div className='text-xs uppercase tracking-wide text-white/50'>Workspace</div>
                {orgs.length > 0 ? (
                  <div className='space-y-2'>
                    {orgs.map((org) => (
                      <button
                        type='button'
                        key={org.id}
                        onClick={() => setSelectedOrgId(org.id)}
                        disabled={finalize.isPending}
                        className={cn(
                          'group flex w-full items-center justify-between rounded-2xl ring-1 py-2 px-3 transition-colors duration-200 disabled:opacity-50',
                          selectedOrgId === org.id
                            ? 'ring-info bg-info/10'
                            : 'ring-white/20 hover:bg-muted/10 cursor-pointer'
                        )}>
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
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className='text-center text-sm text-white/50 py-4'>
                    You are not a member of any workspace yet.
                  </p>
                )}
              </div>

              <Button
                variant='translucent'
                className='w-full'
                onClick={handleFinalize}
                disabled={finalizeDisabled}
                loading={finalize.isPending}
                loadingText='Connecting…'>
                Continue to plan selection
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
