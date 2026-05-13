// apps/kb/src/app/layout.tsx

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Knowledge Base',
  description: 'Knowledge Base',
}

// Paint <html> bg to match the KB mode so overscroll, scrollbars, and any
// area outside the KBThemeProvider div don't flash white in dark mode.
// `:has()` reactively re-matches when the inline NoFlashModeScript flips
// `data-kb-mode` on first paint.
const htmlModeCss = `
html:has([data-kb-mode='dark']) {
  background-color: #1d1d1d;
  color-scheme: dark;
}
html:has([data-kb-mode='light']) {
  background-color: #ffffff;
  color-scheme: light;
}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: htmlModeCss }} />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
