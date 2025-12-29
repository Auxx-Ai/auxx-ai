// apps/web/src/components/ui/sonner.tsx

'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// type ToasterProps = React.ComponentProps<typeof Sonner>

/**
 * Renders the global Sonner toaster with theme-aware styling.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      position="top-right"
      offset={{ top: 10, right: 10, bottom: 10, left: 10 }}
      style={{ '--width': '300px', zIndex: 9999 }}
      richColors
      expand
      visibleToasts={9}
      toastOptions={{
        classNames: {
          toast: 'group toast  group-[.toaster]:text-foreground',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
