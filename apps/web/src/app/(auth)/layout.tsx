import { getAppVersion } from '@auxx/config/client'
import type React from 'react'
import { ColorfulBg } from '~/components/global/login/colorful-bg'
import ThemePicker from './_components/theme-picker'

type Props = { children: React.ReactNode }

function AuthLayout({ children }: Props) {
  const { version } = getAppVersion()

  return (
    <div>
      <div className='absolute top-0 right-0 z-100 pt-2 pr-2'>
        <ThemePicker />
      </div>
      <ColorfulBg>{children}</ColorfulBg>
      <div className='absolute bottom-2 left-3'>
        <span className='text-muted-foreground text-xs'>v{version}</span>
      </div>
    </div>
  )
}

export default AuthLayout
