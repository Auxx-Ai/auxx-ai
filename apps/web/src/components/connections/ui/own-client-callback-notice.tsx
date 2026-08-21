// apps/web/src/components/connections/ui/own-client-callback-notice.tsx
'use client'

import { CopyButton } from '@auxx/ui/components/button-copy'

interface OwnClientCallbackNoticeProps {
  /** Server-built redirect URI. Null/empty renders nothing. */
  callbackUrl?: string | null
}

/**
 * The redirect URI a bring-your-own-client user must register in **their** provider app.
 *
 * Without it every BYO connect dies at the provider with `redirect_uri_mismatch` — an
 * error the user sees on the provider's own page, with nothing in our UI to explain it.
 * The string comes from the server (`providerOAuthCallbackUrl` / `appOAuthCallbackUrl`),
 * the same builder the authorize and callback routes use, so what is shown here is byte
 * -for-byte what we will send.
 *
 * Render this only inside an opened BYO section — it is noise for a platform connect.
 */
export function OwnClientCallbackNotice({ callbackUrl }: OwnClientCallbackNoticeProps) {
  if (!callbackUrl) return null

  return (
    <div className='flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-2'>
      <p className='text-xs text-muted-foreground'>
        Add this redirect URI to your OAuth app before connecting:
      </p>
      <div className='flex items-center gap-1'>
        <code className='min-w-0 flex-1 truncate font-mono text-xs'>{callbackUrl}</code>
        <CopyButton text={callbackUrl} />
      </div>
    </div>
  )
}
