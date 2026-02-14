// apps/web/src/app/api/auth/session/route.ts

import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

/**
 * GET /api/auth/session
 * Validates the current session and returns user data
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  if (!session) {
    return NextResponse.json({ session: null }, { status: 401 })
  }

  return NextResponse.json({
    session: {
      userId: session.user.id,
      userEmail: session.user.email,
      userName: session.user.name,
      userFirstName: session.user.firstName,
      userLastName: session.user.lastName,
      userImage: session.user.image,
    },
  })
}
