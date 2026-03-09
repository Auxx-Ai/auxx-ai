// apps/homepage/src/app/_components/theme-toggle.tsx
'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Button } from '~/components/ui/button'

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

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
