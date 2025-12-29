// apps/web/src/app/(website)/platform/workflow/_components/features-3-cols/human-node-illustration.tsx

import { Clock, Users, Mail, Bell } from 'lucide-react'

/**
 * Static HTML/CSS illustration of the Human Confirmation node for website display
 * Based on the workflow HumanConfirmationNode component
 */
export function HumanNodeIllustration() {
  return (
    <div className="workflow-node relative group/node border-[1px] rounded-2xl transition-all duration-200 after:opacity-0 after:absolute after:inset-[-9px] after:rounded-[24px] after:border-[8px] hover:after:opacity-100 bg-background border-primary-300 after:border-primary-300/20 shadow-lg hover:shadow-lg">
      <div className="group relative shadow-xs flex h-full w-full flex-col rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 pt-3 px-3 pb-2">
            <div className="flex-shrink-0 border rounded-md bg-primary-50 size-7 flex items-center justify-center text-[#6b7280]">
              <Users className="size-4" />
            </div>
            <div className="font-semibold text-sm mr-1 flex grow items-center truncate">
              <div>Human Confirmation</div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="relative px-3 pb-2 space-y-1">
          {/* Assignees section */}
          <div className="relative flex items-center justify-between h-6 rounded-md bg-muted px-2">
            <div className="flex items-center gap-1">
              <Users className="size-3" />
              <div className="whitespace-pre-line">
                <div className="text-sm font-medium">2 users, 1 group</div>
              </div>
            </div>
            <div className="flex gap-1">
              <Bell className="h-3 w-3 text-muted-foreground" />
              <Mail className="h-3 w-3 text-muted-foreground" />
            </div>
          </div>

          {/* Approved handle */}
          <div className="relative flex items-center justify-end h-6 rounded-md bg-good-50">
            <div className="text-xs rounded-md px-1 font-semibold uppercase bg-good-100 text-good-500 whitespace-pre-line">
              Approved
            </div>
            {/* Static handle representation */}
            <div className="absolute top-1/2 -right-[19px] z-[1] h-4 w-4 -translate-y-1/2 after:absolute after:right-[5px] after:top-1 after:h-2 after:w-0.5 after:bg-info" />
          </div>

          {/* Denied handle */}
          <div className="relative flex items-center justify-end p-1 bg-bad-50 rounded-md">
            <div className="text-xs rounded-md px-1 font-semibold uppercase bg-bad-100 text-bad-500 whitespace-pre-line">
              Denied
            </div>
            {/* Static handle representation */}
            <div className="absolute top-1/2 -right-[19px] z-[1] h-4 w-4 -translate-y-1/2 after:absolute after:right-[5px] after:top-1 after:h-2 after:w-0.5 after:bg-info" />
          </div>

          {/* Timeout handle */}
          <div className="relative flex items-center justify-between p-1 bg-accent-100 rounded-md">
            <span className="flex items-center gap-1">
              <Clock className="size-3 text-accent-500" />
              <span className="text-xs text-accent-400">30 minutes</span>
            </span>
            <div className="text-xs rounded-md px-1 font-semibold uppercase bg-accent-100 text-accent-500 whitespace-pre-line">
              Timeout
            </div>
            {/* Static handle representation */}
            <div className="absolute top-1/2 -right-[19px] z-[1] h-4 w-4 -translate-y-1/2 after:absolute after:right-[5px] after:top-1 after:h-2 after:w-0.5 after:bg-info" />
          </div>
        </div>
      </div>
    </div>
  )
}
