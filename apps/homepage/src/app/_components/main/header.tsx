'use client'
import {
  BookOpen,
  Bot,
  Cloud,
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
import { useMedia } from '~/hooks/use-media'
import { config } from '~/lib/config'
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
  {
    href: '/platform/integration',
    name: 'Integration',
    description: 'Connect all your business tools',
    icon: <Plug className='stroke-foreground fill-orange-500/15' />,
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

const contentLinks: FeatureLink[] = [
  {
    name: 'Documentation',
    href: '/docs',
    icon: <BookOpen className='stroke-foreground fill-purple-500/15' />,
  },
  // {
  //   name: 'Customers',
  //   href: '/solutions/customers',
  //   icon: <BookOpen className="stroke-foreground fill-purple-500/15" />,
  // },

  // {
  //   name: 'Case Studies',
  //   href: '/case-studies',
  //   icon: <Croissant className="stroke-foreground fill-red-500/15" />,
  // },
  // {
  //   name: 'Blog',
  //   href: '/blog',
  //   icon: <Notebook className="stroke-foreground fill-zinc-500/15" />,
  // },
]

const moreFeatures: FeatureLink[] = [
  {
    href: '/platform/knowledge-base',
    name: 'Knowledge base',
    description: 'Automate your workflow',
    icon: <Bot className='stroke-foreground fill-yellow-500/15' />,
  },
  {
    href: '/platform/live-chat',
    name: 'Live chat',
    description: 'Scale your application',
    icon: <Rocket className='stroke-foreground fill-orange-500/15' />,
  },
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

const { urls } = config

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
    links: contentLinks,
  },
  { name: 'Platform', href: '/platform/messaging' },
  { name: 'Solutions', href: '/solutions' },
  { name: 'Pricing', href: '/pricing' },
  { name: 'Company', href: '/company' },
  { name: 'Get Started', href: urls.signup },
]

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)
  const [isScrolled, setIsScrolled] = React.useState(false)
  const isLarge = useMedia('(min-width: 64rem)')
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
      <div className='h-18 fixed inset-x-[10px] z-50 '>
        <div
          data-theme='quartz'
          aria-hidden='true'
          className='mask-b-from-35% absolute inset-x-0 -bottom-12 top-0 backdrop-blur max-lg:hidden'></div>
        <div
          data-theme='quartz'
          className='mask-b-from-35% absolute inset-x-0 -bottom-12 top-0 backdrop-blur max-lg:hidden'></div>
        <div
          data-theme='quartz'
          className='bg-background/75 mask-b-from-35% absolute inset-x-0 -bottom-12 top-0 backdrop-blur max-lg:hidden'></div>
      </div>
      <div
        className={cn(
          'max-lg:in-data-[state=active]:bg-background/75 max-lg:in-data-[state=active]:h-screen max-lg:in-data-[state=active]:backdrop-blur max-lg:h-18 fixed inset-x-0 top-0 z-50 pt-2 max-lg:overflow-hidden max-lg:px-2 lg:pt-3'
        )}>
        <div
          className={cn(
            'in-data-scrolled:ring-foreground/5 in-data-scrolled:bg-background/75 in-data-scrolled:shadow-black/10 in-data-scrolled:max-w-4xl max-lg:in-data-scrolled:px-5 in-data-scrolled:backdrop-blur mx-auto w-full max-w-6xl rounded-2xl border border-transparent px-3 shadow-md shadow-transparent ring-1 ring-transparent transition-all duration-500 ease-in-out',
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
                aria-label={isMobileMenuOpen == true ? 'Close Menu' : 'Open Menu'}
                className='relative z-20 -m-2.5 -mr-3 block cursor-pointer p-2.5 lg:hidden'>
                <Menu className='in-data-[state=active]:rotate-180 in-data-[state=active]:scale-0 in-data-[state=active]:opacity-0 m-auto size-5 duration-200' />
                <X className='in-data-[state=active]:rotate-0 in-data-[state=active]:scale-100 in-data-[state=active]:opacity-100 absolute inset-0 m-auto size-5 -rotate-180 scale-0 opacity-0 duration-200' />
              </button>
            </div>

            {isLarge && (
              <div className='absolute inset-0 m-auto size-fit'>
                <NavMenu />
              </div>
            )}
            {!isLarge && isMobileMenuOpen && (
              <MobileMenu closeMenu={() => setIsMobileMenuOpen(false)} />
            )}

            <div className='max-lg:in-data-[state=active]:mt-6 in-data-[state=active]:flex mb-6 hidden w-full flex-wrap items-center justify-end space-y-8 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:shadow-none dark:lg:bg-transparent'>
              <div className='flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit'>
                <Button asChild variant='ghost' size='sm'>
                  <Link href={urls.login}>
                    <span>Login</span>
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

const MobileMenu = ({ closeMenu }: { closeMenu: () => void }) => {
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

const NavMenu = () => {
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
                <div className='bg-linear-to-b inset-ring-foreground/10 inset-ring-1 relative row-span-2 grid overflow-hidden rounded-xl bg-emerald-100 from-white via-white/50 to-sky-100 p-1 transition-colors duration-200 hover:bg-emerald-50'>
                  <div className='aspect-3/2 absolute inset-0 px-6 pt-2'>
                    <div className='mask-b-from-35% before:bg-background before:ring-foreground/10 after:ring-foreground/5 after:bg-background/75 before:z-1 group relative -mx-4 h-4/5 px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-t-xl before:border before:border-transparent before:ring-1 after:absolute after:inset-x-9 after:bottom-0 after:top-2 after:rounded-t-xl after:border after:border-transparent after:ring-1'>
                      <div className='bg-card ring-foreground/10 relative z-10 h-full overflow-hidden rounded-t-xl border border-transparent p-8 text-sm shadow-xl shadow-black/25 ring-1'></div>
                    </div>
                  </div>
                  <div className='space-y-0.5 self-end p-3'>
                    <NavigationMenuLink
                      asChild
                      className='text-foreground p-0 text-sm font-medium before:absolute before:inset-0 hover:bg-transparent focus:bg-transparent'>
                      <Link href='#'>Multimodal Learning</Link>
                    </NavigationMenuLink>
                    <p className='text-foreground/60 line-clamp-1 text-xs'>
                      Explore how our platform integrates text, image, and audio processing into a
                      unified framework.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem value='solutions'>
          <NavigationMenuTrigger>
            <Link href='solutions'>Solutions</Link>
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
                <span className='text-muted-foreground ml-2 text-xs'>Content</span>
                <ul>
                  {contentLinks.map((content, index) => (
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
        <NavigationMenuItem value='company'>
          <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
            <Link href='/company'>Company</Link>
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
