// apps/homepage/src/app/_components/config.ts
import { getHomepageUrl, WEBAPP_URL } from '@auxx/config/client'

const buildAppUrl = (path: string) => {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return new URL(normalized, WEBAPP_URL).toString()
}

export type SiteConfig = typeof config

export const config = {
  name: 'Auxx AI',
  shortName: 'auxx.Ai',
  description: 'Connect AI with Shopify',
  address: '5345 N Commerce Ave, Suite #8, Moorpark, CA 93021',
  emails: {
    privacy: 'privacy@auxx.ai',
    support: 'support@auxx.ai',
    sales: 'sales@auxx.ai',
  },
  urls: {
    homepage: getHomepageUrl(),
    login: buildAppUrl('/login'),
    signup: buildAppUrl('/signup'),
    dashboard: buildAppUrl('/app/settings'),
    pricing: getHomepageUrl('/pricing'),
    demo: getHomepageUrl('/demo'),
  },
  mainNav: [
    {
      title: 'Home',
      href: '/',
    },
  ],
  links: {
    twitter: 'https://x.com/auxxaiapp',
    linkedin: 'https://www.linkedin.com/company/auxx-ai',
    github: 'https://github.com/m4rkuskk/auxxai',
    docs: 'https://auxx-lift.com',
  },
}
