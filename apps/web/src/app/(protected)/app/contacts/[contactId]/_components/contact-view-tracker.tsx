// apps/web/src/app/(protected)/app/contacts/[contactId]/_components/contact-view-tracker.tsx
'use client'

import { useEffect, useRef } from 'react'
import { useAnalytics } from '~/hooks/use-analytics'

/** Tracks contact_viewed event once per contact visit */
export function ContactViewTracker({ contactId }: { contactId: string }) {
  const posthog = useAnalytics()
  const trackedRef = useRef<string | null>(null)

  useEffect(() => {
    if (contactId && contactId !== trackedRef.current) {
      trackedRef.current = contactId
      posthog?.capture('contact_viewed', { contact_id: contactId })
    }
  }, [contactId, posthog])

  return null
}
