// src/app/(protected)/app/settings/chat/[id]/page.tsx
import React from 'react'
import { notFound } from 'next/navigation'
import { database as db } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { auth } from '~/auth/server'
import { ChatWidgetSettings } from '../_components/chat-widget-settings'
import { Metadata } from 'next'
import { headers } from 'next/headers'

export const metadata: Metadata = {
  title: 'Edit Chat Widget',
  description: 'Modify your chat widget settings',
}

async function getWidget(id: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }

  // Get the user's organization
  const [member] = await db.select({ organizationId: schema.OrganizationMember.organizationId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.userId, session.user.id))
    .limit(1)

  if (!member) {
    return null
  }

  // Get the widget
  const [widget] = await db.select()
    .from(schema.ChatWidget)
    .where(and(
      eq(schema.ChatWidget.id, id),
      eq(schema.ChatWidget.organizationId, member.organizationId)
    ))
    .limit(1)

  return widget
}

type EditWidgetParams = { params: Promise<{ widgetId: string }> }
export default async function EditWidgetPage({ params }: EditWidgetParams) {
  const { widgetId } = await params
  const widget = await getWidget(widgetId)

  if (!widget) {
    notFound()
  }

  return (
    <div className="container py-8">
      <ChatWidgetSettings widgetId={widgetId} />
    </div>
  )
}
