// apps/web/src/components/chat-widget/ui/settings/sections/shopify-card.tsx
'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { AlertTriangle, ArrowUpRight, Check, Store } from 'lucide-react'
import { VisualIcon } from '~/components/icons/ui/visual-icon'
import { api } from '~/trpc/react'

const SHOPIFY_APP_STORE_URL = 'https://apps.shopify.com/auxxai'

interface ShopifyCardProps {
  /** The channel this Setup tab is configuring — the one a bind action binds. */
  channelId: string
}

/**
 * "Use this chat channel on your Shopify store" — phase 5 of `plans/chat/shopify`.
 *
 * The storefront theme extension reads a shop metafield to learn which channel to boot.
 * Nothing wrote that metafield before this card existed, which is why storefront chat was
 * invisible to every merchant (and to the App Store reviewer).
 *
 * Scoped to the channel the Setup tab is already on rather than offering a channel picker:
 * the merchant is standing in one channel's settings, so "use *this* one" is the question
 * they actually have. Switching from another channel is handled by binding over it.
 */
export function ShopifyCard({ channelId }: ShopifyCardProps) {
  const utils = api.useUtils()
  const { data, isLoading } = api.shopify.getChatBinding.useQuery()

  const bindChatChannel = api.shopify.bindChatChannel.useMutation({
    onSuccess: async (result) => {
      await utils.shopify.getChatBinding.invalidate()
      // The setting saved but Shopify didn't get the metafield — the admin would otherwise
      // claim "connected" while the storefront renders nothing. Say so, don't swallow it.
      if (!result.metafieldWritten) {
        toastError({
          title: 'Saved, but your store wasn’t updated',
          description: result.reason
            ? `Shopify returned: ${result.reason}. Try again — the widget won’t appear until this succeeds.`
            : 'The widget won’t appear on your storefront until this succeeds. Try again.',
        })
      }
    },
    onError: (error) => {
      toastError({ title: 'Couldn’t update Shopify', description: error.message })
    },
  })

  if (isLoading || !data) return null

  // Not installed, or installed with no store connected — point at the right next step
  // rather than showing a bind control that cannot work.
  if (!data.installed || data.shops.length === 0) {
    return (
      <Card>
        <Header />
        <p className='mt-1 text-xs text-muted-foreground'>
          {data.installed
            ? 'The Auxx app is installed but no store is connected yet. Connect one to put this chat widget on your storefront.'
            : 'Install the Auxx app on your Shopify store to put this chat widget on your storefront — no code to paste.'}
        </p>
        <a
          href={data.installed ? '/app/settings/apps/shopify' : SHOPIFY_APP_STORE_URL}
          target={data.installed ? undefined : '_blank'}
          rel='noreferrer'
          className='mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline'>
          {data.installed ? 'Connect your store' : 'Open the Shopify App Store'}
          <ArrowUpRight className='size-3.5' />
        </a>
      </Card>
    )
  }

  const boundHere = data.boundChannelId === channelId
  const boundElsewhere = Boolean(data.boundChannelId) && !boundHere

  return (
    <Card>
      <Header />

      <div className='mt-4 mb-3 space-y-2'>
        {data.shops.map((shop) => (
          <div
            key={shop.domain}
            className='rounded-md border border-border bg-background px-3 py-2 text-xs'>
            <div className='flex items-center gap-2'>
              <Store className='size-3.5 shrink-0 text-muted-foreground' />
              <span className='font-mono text-foreground'>{shop.domain}</span>
            </div>
            {boundHere && (
              <div className='mt-2 flex flex-wrap items-center gap-2'>
                <Badge variant='outline' className='gap-1 rounded-md'>
                  <Check className='size-3' />
                  Using this channel
                </Badge>
                {/* Only offered once bound — sending someone to enable an embed that has no
                    channel behind it produces a widget that renders nothing. */}
                {shop.themeEditorUrl && (
                  <a
                    href={shop.themeEditorUrl}
                    target='_blank'
                    rel='noreferrer'
                    className='inline-flex items-center gap-1 font-medium text-primary hover:underline'>
                    Enable in theme
                    <ArrowUpRight className='size-3' />
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {boundElsewhere && (
        <Alert className='mb-3'>
          <AlertTriangle className='size-4' />
          <AlertDescription className='text-xs'>
            Another chat channel is currently powering your storefront. Connecting this one replaces
            it.
          </AlertDescription>
        </Alert>
      )}

      <p className='mb-3 text-xs text-muted-foreground'>
        {boundHere
          ? 'This channel powers your storefront widget. Use “Enable in theme” above if you haven’t switched on the “Auxx Chat” app embed yet — the widget won’t appear until you do.'
          : 'Connect this channel, then switch on the “Auxx Chat” app embed in your theme and the widget appears on your storefront.'}
      </p>

      <Button
        variant='outline'
        size='sm'
        loading={bindChatChannel.isPending}
        loadingText={boundHere ? 'Disconnecting...' : 'Connecting...'}
        onClick={() => bindChatChannel.mutate({ channelId: boundHere ? null : channelId })}>
        {boundHere ? 'Disconnect from store' : 'Use this channel on my store'}
      </Button>
    </Card>
  )
}

/**
 * Same shell the Identity tab's `EnforcementCard` uses — `rounded-2xl` on `bg-muted/30`,
 * with `rounded-md` rows on `bg-background` inside it. Kept in sync deliberately: these two
 * are the only bespoke cards in the chat-widget settings and they sit one tab apart.
 */
function Card({ children }: { children: React.ReactNode }) {
  return <div className='relative rounded-2xl border border-border bg-muted/30 p-4'>{children}</div>
}

function Header() {
  return (
    <div className='mb-1 flex items-center gap-2 text-sm font-medium'>
      <VisualIcon value='brand:shopify' size='sm' fallbackIconId='shopping-bag' />
      Shopify
    </div>
  )
}
