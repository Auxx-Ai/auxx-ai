// src/app/(protected)/app/settings/chat/[id]/install/page.tsx

import { database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
// import { WidgetInstallGuide } from '../../_components/widget-install-guide'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import React from 'react'
import { auth } from '~/auth/server'
import { WidgetInstallGuide } from '../../_components/widget-install-guide'

export const metadata: Metadata = {
  title: 'Install Chat Widget',
  description: 'Get installation code for your chat widget',
}

async function getWidget(id: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return null
  }

  // Get the user's organization
  const [member] = await db
    .select({ organizationId: schema.OrganizationMember.organizationId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.userId, session.user.id))
    .limit(1)

  if (!member) {
    return null
  }

  // Get the widget
  const [widget] = await db
    .select()
    .from(schema.ChatWidget)
    .where(
      and(eq(schema.ChatWidget.id, id), eq(schema.ChatWidget.organizationId, member.organizationId))
    )
    .limit(1)

  return widget
}

type InstallWidgetParams = { params: Promise<{ widgetId: string }> }

export default async function InstallWidgetPage({ params }: InstallWidgetParams) {
  const { widgetId } = await params
  const widget = await getWidget(widgetId)

  if (!widget) {
    notFound()
  }

  return (
    <div className='container py-8'>
      <WidgetInstallGuide widgetId={widgetId} widget={widget} />
    </div>
  )
}
