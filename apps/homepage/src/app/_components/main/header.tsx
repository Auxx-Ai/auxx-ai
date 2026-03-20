'use client'
import {
  BookOpen,
  Bot,
  Cloud,
  Code,
  GitBranch,
  Headset,
  Menu,
  MessagesSquare,
  Plug,
  Rocket,
  Shield,
  ShoppingBag,
  Users,
  X,
} from 'lucide-react'
import Link from 'next/link'
import React from 'react'
import { Logo } from '~/components/logo'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion'
import { Button } from '~/components/ui/button'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '~/components/ui/navigation-menu'
import { useConfig } from '~/lib/config-context'
import { cn } from '~/lib/utils'

interface FeatureLink {
  href: string
  name: string
  description?: string
  icon: React.ReactElement
}

interface MobileLink {
  groupName?: string
  links?: FeatureLink[]
  name?: string
  href?: string
}

const features: FeatureLink[] = [
  {
    href: '/platform/messaging',
    name: 'Messaging',
    description: 'Unified customer communication hub',
    icon: <MessagesSquare className='stroke-foreground fill-blue-500/15' />,
  },
  {
    href: '/platform/crm',
    name: 'CRM',
    description: 'Complete customer relationship management',
    icon: <Users className='stroke-foreground fill-green-500/15' />,
  },
  {
    href: '/platform/workflow',
    name: 'Workflow',
    description: 'Automate and streamline processes',
    icon: <GitBranch className='stroke-foreground fill-purple-500/15' />,
  },
]

const useCases: FeatureLink[] = [
  {
    href: '/solutions/shopify-stores',
    name: 'For Shopify Stores',
    description: 'Automate e-commerce support',
    icon: <ShoppingBag className='stroke-foreground fill-emerald-500/25' />,
  },
  {
    href: '/solutions/small-business',
    name: 'For Small Businesses',
    description: 'Automate e-commerce support',
    icon: <ShoppingBag className='stroke-foreground fill-emerald-500/25' />,
  },
  {
    href: '/solutions/customer-support-teams',
    name: 'For Support Teams',
    description: 'Reduce workload by 70%',
    icon: <Headset className='stroke-foreground fill-indigo-500/15' />,
  },
]

const getResourceLinks = (docsUrl: string): FeatureLink[] => [
  {
    name: 'Documentation',
    href: docsUrl,
    icon: <BookOpen className='stroke-foreground fill-purple-500/15' />,
  },
  {
    name: 'Developer Docs',
    href: `${docsUrl}/developer`,
    icon: <Code className='stroke-foreground fill-blue-500/15' />,
  },
]

const moreFeatures: FeatureLink[] = [
  {
    href: '/platform/integration',
    name: 'Integration',
    description: 'Connect all your business tools',
    icon: <Plug className='stroke-foreground fill-orange-500/15' />,
  },
  // {
  //   href: '/platform/knowledge-base',
  //   name: 'Knowledge base',
  //   description: 'Automate your workflow',
  //   icon: <Bot className='stroke-foreground fill-yellow-500/15' />,
  // },
  // {
  //   href: '/platform/live-chat',
  //   name: 'Live chat',
  //   description: 'Scale your application',
  //   icon: <Rocket className='stroke-foreground fill-orange-500/15' />,
  // },
  {
    href: '/platform/ticketing',
    name: 'Ticketing',
    description: 'Keep your data backed up',
    icon: <Cloud className='stroke-foreground fill-teal-500/15' />,
  },
  {
    href: '/platform/manufacturing',
    name: 'Manufacturing',
    description: 'Keep your data safe and secure',
    icon: <Shield className='stroke-foreground fill-blue-500/15' />,
  },
]

export default function Header() {
  const { urls } = useConfig()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)
  const [isScrolled, setIsScrolled] = React.useState(false)
  React.useEffect(() => {
    const handleScroll = () => {
      const scrollContainer = document.getElementById('root')
      if (scrollContainer) {
        const scrollTop = scrollContainer.scrollTop
        setIsScrolled(scrollTop > 50)
      }
    }

    const scrollContainer = document.getElementById('root')
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll)
      // Check initial scroll position
      handleScroll()

      return () => {
        scrollContainer.removeEventListener('scroll', handleScroll)
      }
    }
  }, [])

  return (
    <header
      role='banner'
      data-state={isMobileMenuOpen ? 'active' : 'inactive'}
      {...(isScrolled && { 'data-scrolled': true })}
      className='[--color-popover:color-mix(in_oklch,var(--color-muted)_25%,var(--color-background))]'>
      <div className='h-18 fixed absolute left-0 right-[10px] z-50 '>
        <div
          aria-hidden='true'
          className='mask-b-from-35% absolute inset-x-0 -bottom-12 top-0 backdrop-blur max-lg:hidden'></div>
        <div className='mask-b-from-35% absolute inset-x-0 -bottom-12 top-0 backdrop-blur max-lg:hidden'></div>
        <div className='bg-background/75 mask-b-from-35% absolute inset-x-0 -bottom-12 top-0 backdrop-blur max-lg:hidden'></div>
      </div>
      <div
        className={cn(
          'max-lg:in-data-[state=active]:bg-background/75 max-lg:in-data-[state=active]:h-screen max-lg:in-data-[state=active]:backdrop-blur max-lg:h-18 fixed inset-x-0 top-0 z-50 pt-2 max-lg:overflow-hidden max-lg:px-2 lg:pt-3'
        )}>
        <div
          className={cn(
            'in-data-scrolled:ring-foreground/5 in-data-scrolled:bg-background/75 in-data-scrolled:shadow-black/10 in-data-scrolled:max-w-4xl max-lg:in-data-scrolled:px-5 in-data-scrolled:backdrop-blur mx-auto w-full max-w-6xl rounded-2xl border border-transparent px-3 shadow-md shadow-transparent ring-1 ring-transparent transition-[max-width,padding,background-color,box-shadow,backdrop-filter] duration-500 ease-in-out',
            'max-lg:in-data-[state=active]:backdrop-blur max-lg:in-data-[state=active]:ring-foreground/5 max-lg:in-data-[state=active]:bg-background/75 max-lg:in-data-[state=active]:px-5 max-lg:in-data-[state=active]:shadow-black/10'
          )}>
          <div className='relative flex flex-wrap items-center justify-between lg:py-3'>
            <div className='max-lg:in-data-[state=active]:border-b flex items-center justify-between gap-8 max-lg:h-14 max-lg:w-full'>
              <Link
                href='/'
                aria-label='home'
                className='lg:in-data-scrolled:px-2 h-fit transition-all duration-500'>
                <div className='flex flex-row gap-1.5'>
                  <Logo className='h-7' />
                  <span className='font-bold text-xl'>auxx.Ai</span>
                </div>
                {/* <Stripe className="h-7 w-14" /> */}
              </Link>

              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label={isMobileMenuOpen === true ? 'Close Menu' : 'Open Menu'}
                className='relative z-20 -m-2.5 -mr-3 block cursor-pointer p-2.5 lg:hidden'>
                <Menu className='in-data-[state=active]:rotate-180 in-data-[state=active]:scale-0 in-data-[state=active]:opacity-0 m-auto size-5 duration-200' />
                <X className='in-data-[state=active]:rotate-0 in-data-[state=active]:scale-100 in-data-[state=active]:opacity-100 absolute inset-0 m-auto size-5 -rotate-180 scale-0 opacity-0 duration-200' />
              </button>
            </div>

            <div className='absolute inset-0 m-auto size-fit max-lg:hidden'>
              <NavMenu docsUrl={urls.docs} />
            </div>
            {isMobileMenuOpen && (
              <MobileMenu
                closeMenu={() => setIsMobileMenuOpen(false)}
                signupUrl={urls.signup}
                demoUrl={urls.demo}
                docsUrl={urls.docs}
              />
            )}

            <div className='max-lg:in-data-[state=active]:mt-6 max-lg:hidden max-lg:in-data-[state=active]:flex w-full flex-wrap items-center justify-end space-y-8 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0'>
              <div className='flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit'>
                <Button asChild variant='ghost' size='sm'>
                  <Link href={urls.login}>
                    <span>Login</span>
                  </Link>
                </Button>
                <Button asChild variant='outline' size='sm'>
                  <Link href={urls.demo}>
                    <span>Try Demo</span>
                  </Link>
                </Button>
                <Button asChild variant='default' size='sm'>
                  <Link href={urls.signup}>
                    <span>Start Free Trial</span>
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

const MobileMenu = ({
  closeMenu,
  signupUrl,
  demoUrl,
  docsUrl,
}: {
  closeMenu: () => void
  signupUrl: string
  demoUrl: string
  docsUrl: string
}) => {
  const mobileLinks: MobileLink[] = [
    {
      groupName: 'Platform',
      links: [...features, ...moreFeatures],
    },
    {
      groupName: 'Solutions',
      links: useCases,
    },
    {
      groupName: 'Resources',
      links: getResourceLinks(docsUrl),
    },
    { name: 'Platform', href: '/platform/messaging' },
    { name: 'Solutions', href: '/solutions/shopify-stores' },
    { name: 'Pricing', href: '/pricing' },
    // { name: 'Company', href: '/company' },
    { name: 'Try Demo', href: demoUrl },
    { name: 'Get Started', href: signupUrl },
  ]

  return (
    <nav role='navigation' className='w-full'>
      <Accordion
        type='single'
        collapsible
        className='**:hover:no-underline -mx-4 mt-0.5 space-y-0.5'>
        {mobileLinks.map((link, index) => {
          if (link.groupName && link.links) {
            return (
              <AccordionItem
                key={index}
                value={link.groupName}
                className='group relative border-b-0 before:pointer-events-none before:absolute before:inset-x-4 before:bottom-0 before:border-b'>
                <AccordionTrigger className='**:!font-normal data-[state=open]:bg-muted flex items-center justify-between px-4 py-3 text-lg'>
                  {link.groupName}
                </AccordionTrigger>
                <AccordionContent className='pb-5'>
                  <ul>
                    {link.links.map((feature, featureIndex) => (
                      <li key={featureIndex}>
                        <Link
                          href={feature.href}
                          onClick={closeMenu}
                          className='grid grid-cols-[auto_1fr] items-center gap-2.5 px-4 py-2'>
                          <div aria-hidden className='flex items-center justify-center *:size-4'>
                            {feature.icon}
                          </div>
                          <div className='text-base'>{feature.name}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            )
          }
          return null
        })}
      </Accordion>
      {mobileLinks.map((link, index) => {
        if (link.name && link.href) {
          return (
            <Link
              key={index}
              href={link.href}
              onClick={closeMenu}
              className='group relative block border-0 border-b py-4 text-lg'>
              {link.name}
            </Link>
          )
        }
        return null
      })}
    </nav>
  )
}

const NavMenu = ({ docsUrl }: { docsUrl: string }) => {
  const resourceLinks = getResourceLinks(docsUrl)
  return (
    <NavigationMenu className='**:data-[slot=navigation-menu-viewport]:bg-[color-mix(in_oklch,var(--color-muted)_25%,var(--color-background))] **:data-[slot=navigation-menu-viewport]:shadow-lg **:data-[slot=navigation-menu-viewport]:rounded-2xl **:data-[slot=navigation-menu-viewport]:top-4 [--color-muted:color-mix(in_oklch,var(--color-foreground)_5%,transparent)]  max-lg:hidden'>
      <NavigationMenuList className=''>
        <NavigationMenuItem value='product'>
          <NavigationMenuTrigger>
            <Link href='/platform/messaging'>Platform</Link>
          </NavigationMenuTrigger>
          <NavigationMenuContent className='origin-top pb-1.5 pl-1 pr-1.5 pt-1 backdrop-blur'>
            <div className='min-w-2xl grid w-full grid-cols-3 gap-1'>
              <div className='bg-card row-span-2 grid grid-rows-subgrid gap-1 rounded-xl border p-1 pt-3'>
                <span className='text-muted-foreground ml-2 text-xs'>Features</span>
                <ul>
                  {features.map((feature, index) => (
                    <ListItem
                      key={index}
                      href={feature.href}
                      title={feature.name}
                      description={feature.description}>
                      {feature.icon}
                    </ListItem>
                  ))}
                </ul>
              </div>
              <div className='bg-card col-span-1 row-span-2 grid grid-rows-subgrid gap-1 rounded-xl border p-1 pt-3'>
                <span className='text-muted-foreground ml-2 text-xs'>More Features</span>
                <ul className='grid grid-cols-1'>
                  {moreFeatures.map((feature, index) => (
                    <ListItem
                      key={index}
                      href={feature.href}
                      title={feature.name}
                      description={feature.description}>
                      {feature.icon}
                    </ListItem>
                  ))}
                </ul>
              </div>
              <div className='row-span-2 grid grid-rows-subgrid'>
                <div className='bg-linear-to-b inset-ring-foreground/10 inset-ring-1 relative row-span-2 grid overflow-hidden rounded-xl bg-emerald-100 dark:bg-emerald-500/10 from-white dark:from-background via-white/50 dark:via-background/50 to-sky-100 dark:to-sky-500/10 p-1 transition-colors duration-200 hover:bg-emerald-50 dark:hover:bg-emerald-500/15'>
                  <div className='aspect-3/2 absolute inset-0 px-6 pt-2'>
                    <div className='mask-b-from-35% before:bg-background before:ring-foreground/10 after:ring-foreground/5 after:bg-background/75 before:z-1 group relative -mx-4 h-4/5 px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-t-xl before:border before:border-transparent before:ring-1 after:absolute after:inset-x-9 after:bottom-0 after:top-2 after:rounded-t-xl after:border after:border-transparent after:ring-1'>
                      <div className='bg-card ring-foreground/10 relative z-10 h-full overflow-hidden rounded-t-xl border border-transparent shadow-xl shadow-black/25 ring-1'>
                        <img
                          src='/images/platform/messaging/mail-view-dark.png'
                          alt='AI-powered support'
                          className='size-full scale-150 object-cover object-top-left'
                        />
                      </div>
                    </div>
                  </div>
                  <div className='space-y-0.5 self-end p-3'>
                    <NavigationMenuLink
                      asChild
                      className='text-foreground p-0 text-sm font-medium before:absolute before:inset-0 hover:bg-transparent focus:bg-transparent'>
                      <Link href='/platform/messaging'>AI-Powered Support</Link>
                    </NavigationMenuLink>
                    <p className='text-foreground/60 line-clamp-1 text-xs'>
                      Resolve customer tickets instantly with AI that understands your business.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem value='solutions'>
          <NavigationMenuTrigger>
            <Link href='/solutions/shopify-stores'>Solutions</Link>
          </NavigationMenuTrigger>
          <NavigationMenuContent className='origin-top pb-1.5 pl-1 pr-4 pt-1 backdrop-blur '>
            <div className='min-w-2xl w-full grid grid-cols-2 gap-1'>
              <div className='bg-card col-span-1 row-span-2 grid grid-rows-subgrid gap-1 rounded-xl border p-1 pt-3'>
                <span className='text-muted-foreground ml-2 text-xs'>Use Cases</span>
                <ul className=''>
                  {useCases.map((useCase, index) => (
                    <ListItem
                      key={index}
                      href={useCase.href}
                      title={useCase.name}
                      description={useCase.description}>
                      {useCase.icon}
                    </ListItem>
                  ))}
                </ul>
              </div>
              <div className='row-span-2 grid grid-rows-subgrid gap-1 p-1 pt-3'>
                <span className='text-muted-foreground ml-2 text-xs'>Resources</span>
                <ul>
                  {resourceLinks.map((content, index) => (
                    <NavigationMenuLink key={index} asChild>
                      <Link
                        href={content.href}
                        className='grid grid-cols-[auto_1fr] items-center gap-2.5'>
                        {content.icon}
                        <div className='text-foreground text-sm font-medium'>{content.name}</div>
                      </Link>
                    </NavigationMenuLink>
                  ))}
                </ul>
              </div>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem value='pricing'>
          <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
            <Link href='/pricing'>Pricing</Link>
          </NavigationMenuLink>
        </NavigationMenuItem>
        {/* <NavigationMenuItem value='company'>
          <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
            <Link href='/company'>Company</Link>
          </NavigationMenuLink>
        </NavigationMenuItem> */}
        <NavigationMenuItem value='github'>
          <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
            <Link
              href='https://github.com/Auxx-Ai/auxx-ai'
              target='_blank'
              rel='noopener noreferrer'
              aria-label='GitHub'>
              <GithubIcon className='size-4' />
            </Link>
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )
}

// const NavMenu = ({ activePath }: { activePath: string }) => {
//   // Determines whether the current route is within the features experience.
//   const isFeaturesActive = activePath.startsWith('/features')
//   return (
//     <NavigationMenu
//       viewport={false}
//       className="**:data-[slot=navigation-menu-content]:top-12 max-lg:hidden">
//       <NavigationMenuList className="gap-0">
//         <NavigationMenuItem>
//           <NavigationMenuTrigger>Features</NavigationMenuTrigger>
//           <NavigationMenuContent className="min-w-2xs origin-top p-0.5">
//             <div className="border-foreground/5 bg-card ring-foreground/5 rounded-[calc(var(--radius)-2px)] border p-2 shadow ring-1">
//               <span className="text-muted-foreground ml-2 text-xs">Features</span>
//               <ul className="mt-1 space-y-2">
//                 {features.map((feature, index) => (
//                   <ListItem
//                     key={index}
//                     href={feature.href}
//                     title={feature.name}
//                     description={feature.description}>
//                     {feature.icon}
//                   </ListItem>
//                 ))}
//               </ul>
//             </div>
//             <div className="p-2">
//               <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
//                 <Link href="/features" className="text-indigo-500 text-sm">
//                   Explore features
//                 </Link>
//               </NavigationMenuLink>
//             </div>
//           </NavigationMenuContent>
//         </NavigationMenuItem>
//         <NavigationMenuItem>
//           <NavigationMenuTrigger>Solutions</NavigationMenuTrigger>
//           <NavigationMenuContent className="min-w-lg grid origin-top grid-cols-[auto_1fr] gap-2 p-0.5">
//             <div className="border-foreground/5 bg-card ring-foreground/5 rounded-[calc(var(--radius)-2px)] border border-transparent p-2 shadow ring-1">
//               <span className="text-muted-foreground ml-2 text-xs">Use Cases</span>
//               <ul className="mt-1 space-y-2">
//                 {useCases.map((useCase, index) => (
//                   <ListItem
//                     key={index}
//                     href={useCase.href}
//                     title={useCase.name}
//                     description={useCase.description}>
//                     {useCase.icon}
//                   </ListItem>
//                 ))}
//               </ul>
//             </div>
//             <div className="p-2">
//               <span className="text-muted-foreground ml-2 text-xs">Content</span>
//               <ul className="mt-1">
//                 {contentLinks.map((content, index) => (
//                   <NavigationMenuLink key={index} asChild>
//                     <Link
//                       href={content.href}
//                       className="grid grid-cols-[auto_1fr] items-center gap-2.5">
//                       {content.icon}
//                       <div className="text-foreground text-sm font-medium">{content.name}</div>
//                     </Link>
//                   </NavigationMenuLink>
//                 ))}
//               </ul>
//             </div>
//           </NavigationMenuContent>
//         </NavigationMenuItem>
//         <NavigationMenuItem>
//           <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
//             <Link href="/pricing">Pricing</Link>
//           </NavigationMenuLink>
//         </NavigationMenuItem>
//         <NavigationMenuItem>
//           <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
//             <Link href="/docs">Docs</Link>
//           </NavigationMenuLink>
//         </NavigationMenuItem>
//       </NavigationMenuList>
//     </NavigationMenu>
//   )
// }

function ListItem({
  title,
  description,
  children,
  href,
  ...props
}: React.ComponentPropsWithoutRef<'li'> & { href: string; title: string; description?: string }) {
  return (
    <li {...props}>
      <NavigationMenuLink asChild>
        <Link href={href} className='grid grid-cols-[auto_1fr] gap-3.5'>
          <div className='bg-background ring-foreground/10 before:mask-y-from-80% after:mask-x-from-80% before:border-foreground/[0.075] after:border-foreground/[0.075] relative flex size-9 items-center justify-center rounded border border-transparent shadow shadow-sm ring-1 before:absolute before:-inset-x-1 before:-inset-y-3 before:border-x before:border-dashed after:absolute after:-inset-x-3 after:-inset-y-1 after:border-y after:border-dashed'>
            {children}
          </div>
          <div className='space-y-0.5'>
            <div className='text-foreground text-sm font-medium'>{title}</div>
            <p className='text-muted-foreground line-clamp-1 text-xs'>{description}</p>
          </div>
        </Link>
      </NavigationMenuLink>
    </li>
  )
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 1024 1024'
      fill='currentColor'
      xmlns='http://www.w3.org/2000/svg'
      className={className}>
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0'
      />
    </svg>
  )
}
