import { useTheme } from 'next-themes'
import { useRegisterActions } from 'kbar'

const useThemeSwitching = () => {
  const { theme, setTheme } = useTheme()

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  const themeAction = [
    {
      id: 'toggleTheme',
      name: 'Toggle Theme',
      shortcut: ['t', 't'],
      keywords: 'dark light theme',
      section: 'Theme',
      perform: toggleTheme,
    },
    {
      id: 'setLightTheme',
      name: 'Set Light Theme',
      shortcut: ['t', 'l'],
      keywords: 'light theme',
      section: 'Theme',
      perform: () => setTheme('light'),
    },
    {
      id: 'setDarkTheme',
      name: 'Set Dark Theme',
      shortcut: ['t', 'd'],
      keywords: 'dark theme',
      section: 'Theme',
      perform: () => setTheme('dark'),
    },
  ]
  useRegisterActions(themeAction, [theme])
}

export default useThemeSwitching
