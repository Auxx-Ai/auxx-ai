// apps/web/src/components/apps/app-list-card.tsx
import React from 'react'
import { Code, Mail } from 'lucide-react'
import Link from 'next/link'
import type { AvailableApp } from '@auxx/services/apps'

/**
 * AppListCard component
 * Displays a single app card with title, description, and developer info
 */
export function AppListCard({ app, href }: { app: AvailableApp; href?: string }) {
  const linkHref = href ?? `/app/settings/apps/${app.slug}/`
  return (
    <Link href={linkHref} className="rounded-2xl">
      <div className="rounded-2xl bg-primary-50 flex flex-col p-3 gap-2 border">
        <div className="flex flex-row items-start justify-between gap-2 w-full">
          <div className="flex flex-1 flex-row items-start gap-2">
            <div className="size-8 rounded-xl border flex items-center justify-center">
              <Mail className="size-4" />
            </div>
            <div className="flex flex-col flex-1">
              <div className="flex flex-1 flex-row justify-between">
                <div className="text-sm font-semibold">{app.title}</div>
                <div className="flex items-center flex-row gap-0.5">
                  {app.isDevelopment && (
                    <div className="h-5 gap-2 px-1 shrink-0 bg-primary-100 border flex items-center justify-center rounded-lg">
                      <Code className="size-3" />
                    </div>
                  )}
                  <div className="h-5 gap-2 px-1 shrink-0 bg-primary-100 border flex items-center justify-center rounded-lg">
                    <span className="text-xs">Installed</span>
                  </div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">By {app.developerAccount.title}</div>
            </div>
          </div>
        </div>
        <div className="h-[32px] flex flex-col items-start w-full ">
          <div className="truncate text-sm text-muted-foreground">{app.description}</div>
        </div>
      </div>
    </Link>
  )
}
