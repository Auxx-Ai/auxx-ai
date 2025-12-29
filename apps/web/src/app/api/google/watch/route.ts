import { NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { createScopedLogger } from '@auxx/logger'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

const logger = createScopedLogger('api/google/watch')

export const GET = async () => {
  // const session = await auth()
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user.email) return NextResponse.json({ error: 'Not authenticated' })

  // const gmail = await getGmailClient(session.user.id)

  logger.error('Error watching inbox', { userId: session.user.id })
  return NextResponse.json({ error: 'Error watching inbox' })
}
