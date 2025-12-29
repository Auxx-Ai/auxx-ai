'use client'
import Link from 'next/link'
import { Logo, LogoIcon } from '@/components/logo'
import { Button } from '@/components/ui/button'
import React from 'react'
import { NavigationMenu, NavigationMenuContent, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle } from '@/components/ui/navigation-menu'
import { Headset, Menu, X, Shield, SquareActivity, Sparkles, Cpu, Gem, ShoppingBag, GraduationCap, BookOpen, Notebook, Croissant } from 'lucide-react'
import { useMedia } from '@/hooks/use-media'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'motion/react'

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
        href: '#ux',
        name: 'AI',
        description: 'Generate Insights and Recommendations',
        icon: <Sparkles className="stroke-foreground fill-green-500/15" />,
    },
    {
        href: '#performance',
        name: 'Performance',
        description: 'Lightning-fast load times',
        icon: <SquareActivity className="stroke-foreground fill-indigo-500/15" />,
    },
    {
        href: '#security',
        name: 'Security',
        description: 'Keep your data safe and secure',
        icon: <Shield className="stroke-foreground fill-blue-500/15" />,
    },
    {
        href: '#support',
        name: 'Customer Support',
        description: 'Get help when you need it',
        icon: <Headset className="stroke-foreground fill-pink-500/15" />,
    },
]

const useCases: FeatureLink[] = [
    {
        href: '#ux',
        name: 'Marketplace',
        description: 'Find and buy AI tools',
        icon: <ShoppingBag className="stroke-foreground fill-emerald-500/25" />,
    },
    {
        href: '#performance',
        name: 'Guides',
        description: 'Learn how to use AI tools',
        icon: <GraduationCap className="stroke-foreground fill-indigo-500/15" />,
    },
    {
        href: '#security',
        name: 'API Integration',
        description: 'Integrate AI tools into your app',
        icon: <Cpu className="stroke-foreground fill-blue-500/15" />,
    },
    {
        href: '#support',
        name: 'Partnerships',
        description: 'Get help when you need it',
        icon: <Gem className="stroke-foreground fill-pink-500/15" />,
    },
]

const contentLinks: FeatureLink[] = [
    { name: 'Announcements', href: '#link', icon: <BookOpen className="stroke-foreground fill-purple-500/15" /> },
    { name: 'Resources', href: '#link', icon: <Croissant className="stroke-foreground fill-red-500/15" /> },
    { name: 'Blog', href: '#link', icon: <Notebook className="stroke-foreground fill-zinc-500/15" /> },
]

const mobileLinks: MobileLink[] = [
    {
        groupName: 'Product',
        links: features,
    },
    {
        groupName: 'Solutions',
        links: [...useCases, ...contentLinks],
    },
    { name: 'Pricing', href: '#' },
    { name: 'Company', href: '#' },
]

export default function Header() {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)
    const isLarge = useMedia('(min-width: 64rem)')
    const [isScrolled, setIsScrolled] = React.useState(false)

    React.useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 75)
        }
        window.addEventListener('scroll', handleScroll)
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    React.useEffect(() => {
        const originalOverflow = document.body.style.overflow

        if (isMobileMenuOpen) {
            document.body.style.overflow = 'hidden'
        }

        return () => {
            document.body.style.overflow = originalOverflow
        }
    }, [isMobileMenuOpen])

    return (
        <header
            role="banner"
            data-theme="dark"
            {...(isScrolled && { 'data-scrolled': true })}
            data-state={isMobileMenuOpen ? 'active' : 'inactive'}
            className="bg-background [--color-popover:color-mix(in_oklch,var(--color-muted)_25%,var(--color-background))]">
            <div className={cn('relative', 'not-in-data-scrolled:has-data-[state=open]:[--viewport-translate:-4rem]', !isLarge && 'in-data-scrolled:border-b in-data-scrolled:border-foreground/5 in-data-scrolled:backdrop-blur in-data-scrolled:bg-card/50 fixed inset-x-0 top-0 z-50 h-16 overflow-hidden', 'max-lg:in-data-[state=active]:bg-card/50 max-lg:in-data-[state=active]:h-screen max-lg:in-data-[state=active]:backdrop-blur')}>
                <div className="mx-auto max-w-6xl px-6">
                    <div className="max-lg:not-in-data-[state=active]:h-16 relative flex flex-wrap items-center justify-between py-1.5 lg:py-5">
                        <div className="max-lg:in-data-[state=active]:border-foreground/5 max-lg:in-data-[state=active]:border-b flex items-center justify-between gap-8 max-lg:h-14 max-lg:w-full">
                            <Link
                                href="/"
                                aria-label="home">
                                <Logo className="h-5" />
                            </Link>

                            <button
                                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                                aria-label={isMobileMenuOpen == true ? 'Close Menu' : 'Open Menu'}
                                className="relative z-20 -m-2.5 -mr-3 block cursor-pointer p-2.5 lg:hidden">
                                <Menu className="in-data-[state=active]:rotate-180 in-data-[state=active]:scale-0 in-data-[state=active]:opacity-0 m-auto size-5 duration-200" />
                                <X className="in-data-[state=active]:rotate-0 in-data-[state=active]:scale-100 in-data-[state=active]:opacity-100 absolute inset-0 m-auto size-5 -rotate-180 scale-0 opacity-0 duration-200" />
                            </button>
                        </div>

                        {isLarge && (
                            <motion.div
                                animate={{ width: 'fit-content', gap: 8 }}
                                className="bg-popover/50 ring-background inset-shadow-sm inset-shadow-white/[0.02] border-foreground/5 fixed inset-x-0 z-50 mx-auto size-fit max-w-xl rounded-xl border p-1.5 shadow-xl shadow-black/25 ring-1 backdrop-blur-xl">
                                <div className="flex items-center">
                                    <AnimatePresence>
                                        {isScrolled && (
                                            <motion.div
                                                key="logo"
                                                initial={{ opacity: 0, width: 0 }}
                                                animate={{ opacity: 1, width: '3rem' }}
                                                exit={{ opacity: 0, width: 0 }}
                                                className="before:bg-foreground/10 before:border-background/75 relative before:absolute before:inset-y-1 before:right-2 before:w-0.5 before:rounded before:border-r">
                                                <Link
                                                    href="/"
                                                    aria-label="home"
                                                    className="hover:bg-foreground/5 flex size-7 rounded-md">
                                                    <LogoIcon className="m-auto size-4" />
                                                </Link>
                                            </motion.div>
                                        )}
                                        <NavMenu key="nav-menu" />
                                        {isScrolled && (
                                            <motion.div
                                                key="sign-in-button"
                                                initial={{ opacity: 0, width: 0 }}
                                                animate={{ opacity: 1, width: 'auto' }}
                                                exit={{ opacity: 0, width: 0 }}
                                                className="overflow-hidden">
                                                <Button
                                                    asChild
                                                    size="sm"
                                                    variant="outline"
                                                    className="border-foreground/10 ml-4 h-7 ring-0">
                                                    <Link href="#">
                                                        <span>Sign In</span>
                                                    </Link>
                                                </Button>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </motion.div>
                        )}
                        {!isLarge && isMobileMenuOpen && <MobileMenu closeMenu={() => setIsMobileMenuOpen(false)} />}

                        <div className="max-lg:in-data-[state=active]:mt-6 in-data-[state=active]:flex mb-6 hidden w-full flex-wrap items-center justify-end space-y-8 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:shadow-none dark:lg:bg-transparent">
                            <div className="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit">
                                <Button
                                    asChild
                                    variant="ghost"
                                    size="sm">
                                    <Link href="#">
                                        <span>Sign In</span>
                                    </Link>
                                </Button>
                                <Button
                                    asChild
                                    size="sm">
                                    <Link href="#">
                                        <span>Start for free</span>
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
        <nav
            role="navigation"
            className="w-full [--color-border:--alpha(var(--color-foreground)/5%)] [--color-muted:--alpha(var(--color-foreground)/5%)]">
            <Accordion
                type="single"
                collapsible
                className="**:hover:no-underline -mx-4 mt-0.5 space-y-0.5">
                {mobileLinks.map((link, index) => {
                    if (link.groupName && link.links) {
                        return (
                            <AccordionItem
                                key={index}
                                value={link.groupName}
                                className="before:border-border group relative border-b-0 before:pointer-events-none before:absolute before:inset-x-4 before:bottom-0 before:border-b">
                                <AccordionTrigger className="**:!font-normal data-[state=open]:bg-muted flex items-center justify-between px-4 py-3 text-lg">{link.groupName}</AccordionTrigger>
                                <AccordionContent className="pb-5">
                                    <ul>
                                        {link.links.map((feature, featureIndex) => (
                                            <li key={featureIndex}>
                                                <Link
                                                    href={feature.href}
                                                    onClick={closeMenu}
                                                    className="grid grid-cols-[auto_1fr] items-center gap-2.5 px-4 py-2">
                                                    <div
                                                        aria-hidden
                                                        className="flex items-center justify-center *:size-4">
                                                        {feature.icon}
                                                    </div>
                                                    <div className="text-base">{feature.name}</div>
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
                            className="group relative block border-0 border-b py-4 text-lg">
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
        <NavigationMenu className="**:data-[slot=navigation-menu-viewport]:translate-x-(--viewport-translate) **:data-[slot=navigation-menu-viewport]:transition-all **:data-[slot=navigation-menu-viewport]:min-w-lg **:data-[slot=navigation-menu-viewport]:max-w-2xl **:data-[slot=navigation-menu-viewport]:bg-[color-mix(in_oklch,var(--color-muted)_25%,var(--color-background))] max-lg:hidden">
            <NavigationMenuList className="**:data-[slot=navigation-menu-trigger]:h-7 **:data-[slot=navigation-menu-trigger]:text-foreground/75 **:data-[slot=navigation-menu-trigger]:px-3 **:data-[slot=navigation-menu-trigger]:text-sm gap-0 gap-1">
                <NavigationMenuItem>
                    <NavigationMenuTrigger>Product</NavigationMenuTrigger>
                    <NavigationMenuContent className="w-full origin-top p-0.5 pb-1">
                        <div className="bg-card ring-foreground/5 rounded-[calc(var(--radius)-2px)] border border-transparent p-2 shadow ring-1">
                            <span className="text-muted-foreground ml-2 text-xs">Features</span>
                            <ul className="mt-1 grid grid-cols-2 gap-2">
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
                    </NavigationMenuContent>
                </NavigationMenuItem>
                <NavigationMenuItem>
                    <NavigationMenuTrigger>Solutions</NavigationMenuTrigger>
                    <NavigationMenuContent className="min-w-lg grid w-full origin-top grid-cols-[auto_1fr] gap-2 p-0.5 pb-1">
                        <div className="bg-card ring-foreground/5 rounded-[calc(var(--radius)-2px)] border border-transparent p-2 shadow ring-1">
                            <span className="text-muted-foreground ml-2 text-xs">Use Cases</span>
                            <ul className="mt-1 space-y-2">
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
                        <div className="p-2">
                            <span className="text-muted-foreground ml-2 text-xs">Content</span>
                            <ul className="mt-1">
                                {contentLinks.map((content, index) => (
                                    <NavigationMenuLink
                                        key={index}
                                        asChild>
                                        <Link
                                            href={content.href}
                                            className="grid grid-cols-[auto_1fr] items-center gap-2.5">
                                            {content.icon}
                                            <div className="text-foreground text-sm font-medium">{content.name}</div>
                                        </Link>
                                    </NavigationMenuLink>
                                ))}
                            </ul>
                        </div>
                    </NavigationMenuContent>
                </NavigationMenuItem>
                <NavigationMenuItem>
                    <NavigationMenuLink
                        asChild
                        className={navigationMenuTriggerStyle({ className: 'text-foreground/75 h-7 px-3 text-sm' })}>
                        <Link href="#">Pricing</Link>
                    </NavigationMenuLink>
                </NavigationMenuItem>
                <NavigationMenuItem>
                    <NavigationMenuLink
                        asChild
                        className={navigationMenuTriggerStyle({ className: 'text-foreground/75 h-7 px-3 text-sm' })}>
                        <Link href="#">Customers</Link>
                    </NavigationMenuLink>
                </NavigationMenuItem>
            </NavigationMenuList>
        </NavigationMenu>
    )
}

function ListItem({ title, description, children, href, ...props }: React.ComponentPropsWithoutRef<'li'> & { href: string; title: string; description?: string }) {
    return (
        <li {...props}>
            <NavigationMenuLink asChild>
                <Link
                    href={href}
                    className="grid grid-cols-[auto_1fr] gap-3.5">
                    <div className="bg-background ring-foreground/10 before:mask-y-from-80% after:mask-x-from-80% before:border-foreground/[0.075] after:border-foreground/[0.075] relative flex size-10 items-center justify-center rounded border border-transparent shadow shadow-sm ring-1 before:absolute before:-inset-x-1 before:-inset-y-3 before:border-x before:border-dashed after:absolute after:-inset-x-3 after:-inset-y-1 after:border-y after:border-dashed">{children}</div>
                    <div className="space-y-0.5">
                        <div className="text-foreground text-sm font-medium">{title}</div>
                        <p className="text-muted-foreground line-clamp-1 text-xs">{description}</p>
                    </div>
                </Link>
            </NavigationMenuLink>
        </li>
    )
}