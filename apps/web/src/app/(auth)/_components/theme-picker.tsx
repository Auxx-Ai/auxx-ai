// apps/web/src/app/(auth)/_components/theme-picker.tsx
'use client'

import { useEffect, useId, useState } from 'react'
import { MoonIcon, SunIcon } from 'lucide-react'

import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import { useTheme } from 'next-themes'

// ThemePicker renders the theme toggle switch and syncs it with next-themes state
export default function ThemePicker() {
  const id = useId()
  const { resolvedTheme, setTheme, theme } = useTheme()
  // isMounted ensures theme state reads happen only on the client
  const [isMounted, setIsMounted] = useState<boolean>(false)

  // Track mount status to avoid hydration mismatches with next-themes
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // handleSwitchChange applies the selected theme to the app
  const handleSwitchChange = (isChecked: boolean) => {
    setTheme(isChecked ? 'light' : 'dark')
  }

  // activeTheme tracks the effective theme, respecting system preference when selected
  const activeTheme = theme === 'system' ? resolvedTheme : theme
  // Determine the checked state after hydration using resolved theme value
  const shouldShowLightTheme = isMounted && activeTheme === 'light'

  return (
    <div className="">
      <div className="relative inline-grid h-6 w-12 grid-cols-[1fr_1fr] items-center text-sm font-medium">
        <Switch
          id={id}
          size="sm"
          checked={shouldShowLightTheme}
          onCheckedChange={handleSwitchChange}
          className="peer data-[state=unchecked]:bg-input/50 absolute inset-0 h-[inherit] w-auto [&_span]:z-10 [&_span]:h-full [&_span]:w-1/2 [&_span]:transition-transform [&_span]:duration-300 [&_span]:ease-[cubic-bezier(0.16,1,0.3,1)] [&_span]:data-[state=checked]:translate-x-full [&_span]:data-[state=checked]:rtl:-translate-x-full"
        />
        <span className="pointer-events-none relative ms-0.5 flex w-6 items-center justify-center text-center transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] peer-data-[state=checked]:invisible peer-data-[state=unchecked]:translate-x-full peer-data-[state=unchecked]:rtl:-translate-x-full">
          <MoonIcon className="size-3" aria-hidden="true" />
        </span>
        <span className="peer-data-[state=checked]:text-background pointer-events-none relative me-0.5 flex w-6 items-center justify-center text-center transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] peer-data-[state=checked]:-translate-x-full peer-data-[state=unchecked]:invisible peer-data-[state=checked]:rtl:translate-x-full">
          <SunIcon className="size-3" aria-hidden="true" />
        </span>
      </div>
      <Label htmlFor={id} className="sr-only">
        Labeled switch
      </Label>
    </div>
  )
}
