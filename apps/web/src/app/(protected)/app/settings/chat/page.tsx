// src/app/(protected)/app/settings/chat/page.tsx
import React from 'react'
import { Metadata } from 'next'
import Link from 'next/link'
import { auth } from '~/auth/server'
import { database as db } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq, desc } from 'drizzle-orm'
import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { Plus, Edit, Code, ExternalLink, Check, X } from 'lucide-react'
import { Badge } from '@auxx/ui/components/badge'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { headers } from 'next/headers'

export const metadata: Metadata = { title: 'Chat Widgets', description: 'Manage your chat widgets' }

async function getWidgets() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    return []
  }

  // Get the user's organization
  const [member] = await db
    .select({ organizationId: schema.OrganizationMember.organizationId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.userId, session.user.id))
    .limit(1)

  if (!member) {
    return []
  }

  // Get widgets
  const widgets = await db
    .select()
    .from(schema.ChatWidget)
    .where(eq(schema.ChatWidget.organizationId, member.organizationId))
    .orderBy(desc(schema.ChatWidget.createdAt))

  return widgets
}

export default async function ChatWidgetsPage() {
  const widgets = await getWidgets()

  return (
    <div className="container py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chat Widgets</h1>
          <p className="text-muted-foreground">Create and manage chat widgets for your websites</p>
        </div>

        <Button asChild>
          <Link href="/app/settings/chat/new">
            <Plus className="mr-2 h-4 w-4" />
            New Widget
          </Link>
        </Button>
      </div>

      {widgets.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No chat widgets yet</CardTitle>
            <CardDescription>
              Create your first chat widget to start offering real-time support on your website.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link href="/app/settings/chat/new">
                <Plus className="mr-2 h-4 w-4" />
                Create Widget
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {widgets.map((widget) => (
            <Card key={widget.id} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="truncate">{widget.name}</CardTitle>
                  <Badge variant={widget.isActive ? 'default' : 'secondary'}>
                    {widget.isActive ? (
                      <Check className="mr-1 h-3 w-3" />
                    ) : (
                      <X className="mr-1 h-3 w-3" />
                    )}
                    {widget.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <CardDescription className="truncate">
                  {widget.description || 'No description'}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex-1">
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">Widget Preview</p>
                    <div
                      className="relative mt-2 flex h-32 items-center justify-center overflow-hidden rounded-md border"
                      style={{ backgroundColor: widget.primaryColor || '#4F46E5' }}>
                      <div className="absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-lg">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </div>

                      <div className="absolute left-0 top-0 flex w-full items-center p-3">
                        {widget.logoUrl && (
                          <div className="mr-2 flex h-6 w-6 items-center justify-center overflow-hidden rounded bg-white">
                            <img
                              src={widget.logoUrl}
                              alt="Logo"
                              className="max-h-full max-w-full"
                            />
                          </div>
                        )}
                        <div className="text-left text-white">
                          <div className="text-sm font-medium">{widget.title}</div>
                          {widget.subtitle && (
                            <div className="text-xs opacity-80">{widget.subtitle}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {widget.allowedDomains && widget.allowedDomains.length > 0 && (
                    <div>
                      <p className="text-sm font-medium">Allowed Domains</p>
                      <ScrollArea className="mt-1 h-20 w-full rounded-md border p-2">
                        {widget.allowedDomains.map((domain, index) => (
                          <div key={index} className="py-1 text-xs">
                            {domain}
                          </div>
                        ))}
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </CardContent>

              <CardFooter className="grid grid-cols-2 gap-2 border-t pt-4">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/app/settings/chat/${widget.id}`}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/app/settings/chat/${widget.id}/install`}>
                    <Code className="mr-2 h-4 w-4" />
                    Install
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
