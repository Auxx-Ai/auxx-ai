// apps/web/src/app/(protected)/app/kopilot/[sessionId]/page.tsx

'use client'

import { use } from 'react'
import { KopilotPageShell } from '~/components/kopilot/ui/kopilot-page-shell'

export default function KopilotSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  return <KopilotPageShell sessionId={sessionId} />
}
