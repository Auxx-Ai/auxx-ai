import type React from 'react'

type Props = { children: React.ReactNode }

async function MailLayout({ children }: Props) {
  return <div className='flex h-screen w-full bg-neutral-100 dark:bg-primary-100'>{children}</div>
}

export default MailLayout
