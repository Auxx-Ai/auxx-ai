// apps/kb/src/app/page.tsx
// Public KB roots are served at /<orgSlug>/<kbSlug>/. The bare root has no
// useful content; redirect visitors to the marketing site.

import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect(process.env.KB_MARKETING_URL ?? 'https://auxx.ai')
}
