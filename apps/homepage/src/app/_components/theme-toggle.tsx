// apps/homepage/src/app/_components/theme-toggle.tsx
'use client'

import { Moon, Sun } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { useTheme } from '~/lib/theme'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Button
      variant='ghost'
      size='icon'
      className='size-7'
      onClick={() => setTheme(isDark ? 'quartz' : 'dark')}>
      {isDark ? <Sun className='h-4 w-4' /> : <Moon className='h-4 w-4' />}
      <span className='sr-only'>Toggle theme</span>
    </Button>
  )
}
