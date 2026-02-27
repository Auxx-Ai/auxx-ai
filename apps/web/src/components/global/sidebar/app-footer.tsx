'use client'
import { BorderBeam } from '@auxx/ui/components/border-beam'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
import { SidebarButton } from '@auxx/ui/components/sidebar-button'
import {
  ArrowUpRight,
  Book,
  BookCheck,
  BookLock,
  CircleHelp,
  Code2,
  Cog,
  Globe,
  Heart,
  HeartPulse,
  Linkedin,
  Mail,
  Rocket,
  Section,
  Twitter,
  Zap,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'
import { useSubscription } from '~/hooks/use-subscription'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { NotificationCenter } from '../notifications/notification-center'

const PlanChangeSummary = dynamic(
  () =>
    import('~/components/subscriptions/plan-change-summary').then((module) => ({
      default: module.PlanChangeSummary,
    })),
  {
    ssr: false,
  }
)

type Props = {}

function AppFooter({}: Props) {
  const pathname = usePathname()
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const { version, homepageUrl, docsUrl } = useEnv()

  function isActive(url: string) {
    return pathname.startsWith(url) || pathname === url
  }

  return (
    <SidebarGroup className='px-0'>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={isActive('/app/settings') && !isHelpOpen}
            tooltip='Settings'>
            <Link href='/app/settings'>
              <Cog />
              <span>Settings</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <NotificationCenter />

        <SidebarMenuItem>
          <DropdownMenu open={isHelpOpen} onOpenChange={setIsHelpOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton isActive={isHelpOpen || isActive('/app/help')} tooltip='Help'>
                <CircleHelp />
                <span>Help and resources</span>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent className='w-56' align='end' side='right'>
              <DropdownMenuGroup>
                <DropdownMenuLabel className='text-xs text-muted-foreground'>
                  SUPPORT
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={`mailto:support@auxx.ai`} target='_blank' rel='noopener noreferrer'>
                    <Mail />
                    <div className='flex flex-col items-start justify-start'>
                      <span>Email Support</span>
                      <span className='text-muted-foreground'>support@auxx.ai</span>
                    </div>
                    <ArrowUpRight className='text-muted-foreground' />
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={docsUrl} target='_blank' rel='noopener noreferrer'>
                    <Book /> Read the help center
                    <ArrowUpRight className='text-muted-foreground' />
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className='text-xs text-muted-foreground'>
                  RESOURCES
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={docsUrl} target='_blank' rel='noopener noreferrer'>
                    <Code2 /> API docs
                    <ArrowUpRight className='text-muted-foreground' />
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Globe />
                      <span>Website</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className='w-56'>
                      <DropdownMenuItem asChild>
                        <Link href={homepageUrl} target='_blank' rel='noopener noreferrer'>
                          <Globe />
                          Main site
                          <ArrowUpRight className='text-muted-foreground' />
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href={`${homepageUrl}/changelog`}
                          target='_blank'
                          rel='noopener noreferrer'>
                          <Rocket />
                          Changelog
                          <ArrowUpRight className='text-muted-foreground' />
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href={`${homepageUrl}/status`}
                          target='_blank'
                          rel='noopener noreferrer'>
                          <HeartPulse />
                          Status
                          <ArrowUpRight className='text-muted-foreground' />
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
                    <DropdownMenuSubContent className='w-56'>
                      <DropdownMenuItem asChild>
                        <Link
                          href={`${homepageUrl}/terms-of-service`}
                          target='_blank'
                          rel='noopener noreferrer'>
                          <BookCheck />
                          Terms of Service
                          <ArrowUpRight className='text-muted-foreground' />
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href={`${homepageUrl}/privacy-policy`}
                          target='_blank'
                          rel='noopener noreferrer'>
                          <BookLock />
                          Privacy Policy
                          <ArrowUpRight className='text-muted-foreground' />
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
                    <DropdownMenuSubContent className='w-56' side='bottom'>
                      {/* <DropdownMenuItem asChild>
                        <Link
                          href={`${homepageUrl}/terms-of-service`}
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
                          href='https://www.linkedin.com/company/auxx-ai'
                          className=''
                          target='_blank'
                          rel='noopener noreferrer'>
                          <Linkedin />
                          <div className='flex flex-col items-start justify-start'>
                            <span>LinkedIn</span>
                            <span className='text-muted-foreground'>@auxxai</span>
                          </div>
                          <ArrowUpRight className='text-muted-foreground' />
                        </Link>
                      </DropdownMenuItem>

                      <DropdownMenuItem asChild>
                        <Link
                          href='https://x.com/auxxaiapp'
                          className=''
                          target='_blank'
                          rel='noopener noreferrer'>
                          <Twitter />
                          <div className='flex flex-col items-start justify-start'>
                            <span>Twitter</span>
                            <span className='text-muted-foreground'>@auxxaiapp</span>
                          </div>
                          <ArrowUpRight className='text-muted-foreground' />
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <div className='px-2 py-1.5 text-[11px] text-muted-foreground/60'>
                {version.appVersion} ({version.commit})
              </div>
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
  const selfHosted = useIsSelfHosted()
  const subscription = useSubscription()

  // Self-hosted deployments don't have trials
  if (selfHosted) return null

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
      <div className='mx-auto'>
        <SidebarButton
          variant='outline'
          className='mt-2 relative h-8.5 rounded-full'
          tooltip='Trial Status'
          onClick={() => setDialogOpen(true)}>
          <BorderBeam />
          <Zap className='size-4' />
          <span className='group-data-[collapsible=icon]:hidden ps-3 pe-4'>
            {daysRemaining} {daysText} left on trial
          </span>
        </SidebarButton>
      </div>

      {dialogOpen ? <PlanChangeSummary open={dialogOpen} onOpenChange={setDialogOpen} /> : null}
    </>
  )
}
