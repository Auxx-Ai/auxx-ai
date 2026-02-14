// apps/build/src/app/api/auth/session/route.ts

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '~/lib/auth'

/**
 * GET /api/auth/session
 * Returns current session data for client-side access
 */
export async function GET(request: NextRequest) {
  const session = await getSession()

  if (!session) {
    return NextResponse.json({ session: null }, { status: 401 })
  }

  return NextResponse.json({ session })
}
