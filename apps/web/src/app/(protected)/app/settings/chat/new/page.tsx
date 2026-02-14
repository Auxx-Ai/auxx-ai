import type { Metadata } from 'next'
import { ChatWidgetSettings } from '../_components/chat-widget-settings'

// src/app/(protected)/app/settings/chat/new/page.tsx
export const metadata: Metadata = {
  title: 'Create Chat Widget',
  description: 'Create a new chat widget for your website',
}

export default function NewWidgetPage() {
  return (
    <div className='container py-8'>
      <ChatWidgetSettings />
    </div>
  )
}
