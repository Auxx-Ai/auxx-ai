// apps/homepage/src/app/demo/route.ts
import { redirect } from 'next/navigation'
import { config } from '~/lib/config'

export function GET() {
  redirect(config.urls.demo)
}
