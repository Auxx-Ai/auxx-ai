// apps/web/src/components/kbar/use-theme-switching.tsx
import { useHotkeySequence } from '@tanstack/react-hotkeys'
import { useRegisterActions } from 'kbar'
import { useTheme } from 'next-themes'

const useThemeSwitching = () => {
  const { theme, setTheme } = useTheme()

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  // Register tanstack hotkey sequences (these don't conflict with single-key shortcuts)
  useHotkeySequence(['T', 'T'], toggleTheme, { timeout: 500 })
  useHotkeySequence(['T', 'L'], () => setTheme('light'), { timeout: 500 })
  useHotkeySequence(['T', 'D'], () => setTheme('dark'), { timeout: 500 })

  // Register kbar actions for discoverability (no shortcut — tanstack handles the keys)
  const themeAction = [
    {
      id: 'toggleTheme',
      name: 'Toggle Theme',
      icon: 'sun',
      keywords: 'dark light theme',
      section: 'Theme',
      perform: toggleTheme,
    },
    {
      id: 'setLightTheme',
      name: 'Set Light Theme',
      icon: 'sun',
      keywords: 'light theme',
      section: 'Theme',
      perform: () => setTheme('light'),
    },
    {
      id: 'setDarkTheme',
      name: 'Set Dark Theme',
      icon: 'moon',
      keywords: 'dark theme',
      section: 'Theme',
      perform: () => setTheme('dark'),
    },
  ]
  useRegisterActions(themeAction, [theme])
}

export default useThemeSwitching
