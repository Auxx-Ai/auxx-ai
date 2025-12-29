'use client'
import {
  ArrowUpRight,
  Bell,
  Book,
  BookCheck,
  BookLock,
  CircleHelp,
  Code2,
  Cog,
  Globe,
  Heart,
  HeartPulse,
  Instagram,
  Linkedin,
  Mail,
  Rocket,
  Section,
  Twitter,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useState } from 'react'
import { SidebarButton } from '@auxx/ui/components/sidebar-button'
import {
  DropdownMenuGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@auxx/ui/components/sidebar'
import { BorderBeam } from '@auxx/ui/components/border-beam'
import { NotificationCenter } from '../notifications/notification-center'
import { HOMEPAGE_URL, WEBAPP_URL } from '@auxx/config/client'
// import { PlanChangeSummary } from '~/app/(protected)/app/settings/plans/_components/plan-change-summary'
import { useSubscription } from '~/hooks/use-subscription'
import { PlanChangeSummary } from '~/components/subscriptions/plan-change-summary'

type Props = {}

function AppFooter({}: Props) {
  const pathname = usePathname()
  const [isHelpOpen, setIsHelpOpen] = useState(false)

  function isActive(url: string) {
    return pathname.startsWith(url) || pathname === url
  }

  return (
    <SidebarGroup className="px-0">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={isActive('/app/settings') && !isHelpOpen}
            tooltip="Settings">
            <Link href="/app/settings">
              <Cog />
              <span>Settings</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <NotificationCenter />

        <SidebarMenuItem>
          <DropdownMenu open={isHelpOpen} onOpenChange={setIsHelpOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton isActive={isHelpOpen || isActive('/app/help')} tooltip="Help">
                <CircleHelp className="h-4 w-4" />
                <span>Help and resources</span>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" side="right">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  SUPPORT
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={`mailto:support@auxx.ai`} target="_blank" rel="noopener noreferrer">
                    <Mail />
                    <div className="flex flex-col items-start justify-start">
                      <span>Email Support</span>
                      <span className="text-muted-foreground">support@auxx.ai</span>
                    </div>
                    <ArrowUpRight className="text-muted-foreground" />
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`${WEBAPP_URL}/docs`} target="_blank" rel="noopener noreferrer">
                    <Book /> Read the help center
                    <ArrowUpRight className="text-muted-foreground" />
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  RESOURCES
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={`${WEBAPP_URL}/docs`} target="_blank" rel="noopener noreferrer">
                    <Code2 /> API docs
                    <ArrowUpRight className="text-muted-foreground" />
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Globe />
                      <span>Website</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-56">
                      <DropdownMenuItem asChild>
                        <Link href={`${HOMEPAGE_URL}`} target="_blank" rel="noopener noreferrer">
                          <Globe />
                          Main site
                          <ArrowUpRight className="text-muted-foreground" />
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href={`${HOMEPAGE_URL}/changelog`}
                          target="_blank"
                          rel="noopener noreferrer">
                          <Rocket />
                          Changelog
                          <ArrowUpRight className="text-muted-foreground" />
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href={`${HOMEPAGE_URL}/status`}
                          target="_blank"
                          rel="noopener noreferrer">
                          <HeartPulse />
                          Status
                          <ArrowUpRight className="text-muted-foreground" />
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Section />
                      <span>Legal</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-56">
                      <DropdownMenuItem asChild>
                        <Link
                          href={`${HOMEPAGE_URL}/terms-of-service`}
                          target="_blank"
                          rel="noopener noreferrer">
                          <BookCheck />
                          Terms of Service
                          <ArrowUpRight className="text-muted-foreground" />
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href={`${HOMEPAGE_URL}/privacy-policy`}
                          target="_blank"
                          rel="noopener noreferrer">
                          <BookLock />
                          Privacy Policy
                          <ArrowUpRight className="text-muted-foreground" />
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Heart />
                      <span>Social</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-56" side="bottom">
                      {/* <DropdownMenuItem asChild>
                        <Link
                          href={`${HOMEPAGE_URL}/terms-of-service`}
                          className=""
                          target="_blank"
                          rel="noopener noreferrer">
                          <Instagram />
                          <div className="flex flex-col items-start justify-start">
                            <span>Instagram</span>
                            <span className="text-muted-foreground">@auxxai</span>
                          </div>
                          <ArrowUpRight className="text-muted-foreground" />
                        </Link>
                      </DropdownMenuItem> */}
                      <DropdownMenuItem asChild>
                        <Link
                          href="https://www.linkedin.com/company/auxx-ai"
                          className=""
                          target="_blank"
                          rel="noopener noreferrer">
                          <Linkedin />
                          <div className="flex flex-col items-start justify-start">
                            <span>LinkedIn</span>
                            <span className="text-muted-foreground">@auxxai</span>
                          </div>
                          <ArrowUpRight className="text-muted-foreground" />
                        </Link>
                      </DropdownMenuItem>

                      <DropdownMenuItem asChild>
                        <Link
                          href="https://x.com/auxxaiapp"
                          className=""
                          target="_blank"
                          rel="noopener noreferrer">
                          <Twitter />
                          <div className="flex flex-col items-start justify-start">
                            <span>Twitter</span>
                            <span className="text-muted-foreground">@auxxaiapp</span>
                          </div>
                          <ArrowUpRight className="text-muted-foreground" />
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <UpgradeButton />
    </SidebarGroup>
  )
}

export default AppFooter

function UpgradeButton() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const subscription = useSubscription()

  // Don't render if not in trial or trial has ended
  if (
    !subscription ||
    subscription.status !== 'trialing' ||
    subscription.hasTrialEnded ||
    !subscription.trialEnd
  ) {
    return null
  }

  // Calculate days remaining
  const now = new Date()
  const daysRemaining = Math.max(
    0,
    Math.ceil((new Date(subscription.trialEnd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  )

  const daysText = daysRemaining === 1 ? 'day' : 'days'

  return (
    <>
      <div className="mx-auto">
        <SidebarButton
          variant="outline"
          className="mt-2 relative h-8.5 rounded-full"
          tooltip="Trial Status"
          onClick={() => setDialogOpen(true)}>
          <BorderBeam />
          <Zap className="size-4" />
          <span className="group-data-[collapsible=icon]:hidden ps-3 pe-4">
            {daysRemaining} {daysText} left on trial
          </span>
        </SidebarButton>
      </div>

      <PlanChangeSummary open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
