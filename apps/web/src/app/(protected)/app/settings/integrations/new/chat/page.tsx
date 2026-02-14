// ~/app/(protected)/app/settings/integrations/new/chat_widget/page.tsx
'use client'
import { Button } from '@auxx/ui/components/button'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React from 'react'
import ChatWidgetIntegrationForm from '../../_components/chat-widget-integration-form'

/**
 * Page for creating a new Chat Widget Integration.
 */
export default function NewChatWidgetPage() {
  const router = useRouter()
  const handleBack = () => router.push('/app/settings/integrations/new') // Go back to chooser

  return <ChatWidgetIntegrationForm />
}
