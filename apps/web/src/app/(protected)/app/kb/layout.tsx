import type React from 'react'

type Props = { children: React.ReactNode }

function KBLayout({ children }: Props) {
  return (
    <div className='flex flex-1 grow overflow-hidden bg-neutral-100 dark:bg-background'>
      {children}
    </div>
  )
}

export default KBLayout
