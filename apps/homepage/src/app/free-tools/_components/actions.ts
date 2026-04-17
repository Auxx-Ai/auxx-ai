// apps/homepage/src/app/free-tools/_components/actions.ts
'use server'

import { INTERNAL_API_URL } from '@auxx/config/server'
import { headers } from 'next/headers'

export type SubmitLeadResult = { ok: true } | { ok: false; error: string }

export async function submitFreeToolLead(input: {
  toolSlug: string
  email: string
  name?: string
  website?: string
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
}): Promise<SubmitLeadResult> {
  const h = await headers()
  const referer = h.get('referer') ?? undefined
  const userAgent = h.get('user-agent') ?? undefined
  const forwardedFor = h.get('x-forwarded-for') ?? undefined

  try {
    const res = await fetch(`${INTERNAL_API_URL}/api/v1/public/free-tool-leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(referer ? { referer } : {}),
        ...(userAgent ? { 'user-agent': userAgent } : {}),
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
      },
      body: JSON.stringify(input),
      cache: 'no-store',
    })
    if (!res.ok) {
      return { ok: false, error: 'Something went wrong. Please try again.' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not reach the server. Please try again.' }
  }
}
