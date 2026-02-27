// apps/build/src/app/api/auth/logout/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { NextResponse } from 'next/server'

export async function GET() {
  const response = NextResponse.redirect(`${WEBAPP_URL}/login`, { status: 303 })
  response.cookies.delete('auxx-build.session')
  return response
}
