import type React from 'react'

type Props = { children: React.ReactNode }

async function MailLayout({ children }: Props) {
  return (
    <div className='flex flex-1 min-h-0 flex-col w-full bg-neutral-100 dark:bg-primary-100'>
      {children}
    </div>
  )
}

export default MailLayout
