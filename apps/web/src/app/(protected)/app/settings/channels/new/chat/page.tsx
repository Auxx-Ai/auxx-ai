// ~/app/(protected)/app/settings/channels/new/chat_widget/page.tsx
'use client'
import { useRouter } from 'next/navigation'
import ChatWidgetIntegrationForm from '../../_components/chat-widget-integration-form'

/**
 * Page for creating a new Chat Widget Integration.
 */
export default function NewChatWidgetPage() {
  const router = useRouter()
  const handleBack = () => router.push('/app/settings/channels/new') // Go back to chooser

  return <ChatWidgetIntegrationForm />
}
