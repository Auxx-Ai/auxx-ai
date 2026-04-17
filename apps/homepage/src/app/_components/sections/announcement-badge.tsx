// apps/homepage/src/app/_components/sections/announcement-badge.tsx
import Link from 'next/link'

type AnnouncementBadgeProps = {
  href: string
  text: string
  linkText?: string
}

export function AnnouncementBadge({ href, text, linkText = 'Read' }: AnnouncementBadgeProps) {
  return (
    <Link
      href={href}
      className='group bg-foreground/5 relative mx-auto block w-fit p-2 transition-colors hover:bg-foreground/10'>
      <div aria-hidden className='bg-foreground/20 absolute left-1 top-1 size-[3px] rounded-full' />
      <div
        aria-hidden
        className='bg-foreground/20 absolute right-1 top-1 size-[3px] rounded-full'
      />
      <div
        aria-hidden
        className='bg-foreground/20 absolute bottom-1 left-1 size-[3px] rounded-full'
      />
      <div
        aria-hidden
        className='bg-foreground/20 absolute bottom-1 right-1 size-[3px] rounded-full'
      />
      <div className='bg-illustration relative flex h-fit items-center gap-2 rounded-full px-3 py-1 shadow-sm dark:border'>
        <span className='text-muted-foreground text-sm'>{text}</span>
        <span className='bg-foreground/10 block h-3 w-px' />
        <span className='text-foreground text-sm font-medium group-hover:underline'>
          {linkText}
        </span>
      </div>
    </Link>
  )
}
