// apps/web/src/app/api/auth/login-token/route.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { issueLoginToken, sanitizeReturnTo } from '@auxx/credentials/login-token'
import { database, schema } from '@auxx/database'
import { isOrgMember } from '@auxx/lib/cache'
import { getDemoEmailDomain } from '@auxx/lib/demo'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { resolveTrustedAppOrigin } from '~/auth/trusted-apps'

export async function POST(request: NextRequest) {
  // 1. Verify the user has a valid session
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse request body
  const body = await request.json()
  const { callbackApp, returnTo, kbId } = body as {
    callbackApp?: unknown
    returnTo?: unknown
    kbId?: unknown
  }

  if (!callbackApp || typeof callbackApp !== 'string') {
    return NextResponse.json({ error: 'Missing callbackApp' }, { status: 400 })
  }

  // 3. Per-app gates
  const isDemoUser = session.user.email.endsWith(`@${getDemoEmailDomain()}`)

  if (callbackApp === 'build') {
    if (isDemoUser) {
      return NextResponse.json(
        { error: 'Demo accounts cannot access the developer portal' },
        { status: 403 }
      )
    }
  } else if (callbackApp === 'kb') {
    if (isDemoUser) {
      return NextResponse.json(
        { error: 'Demo accounts cannot access knowledge bases' },
        { status: 403 }
      )
    }
    if (!kbId || typeof kbId !== 'string') {
      return NextResponse.json({ error: 'Missing kbId' }, { status: 400 })
    }
    const [kb] = await database
      .select({
        id: schema.KnowledgeBase.id,
        organizationId: schema.KnowledgeBase.organizationId,
        visibility: schema.KnowledgeBase.visibility,
      })
      .from(schema.KnowledgeBase)
      .where(eq(schema.KnowledgeBase.id, kbId))
      .limit(1)

    if (!kb) {
      return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
    }
    if (kb.visibility !== 'INTERNAL') {
      return NextResponse.json(
        { error: 'Login tokens are only issued for internal knowledge bases' },
        { status: 400 }
      )
    }
    const member = await isOrgMember(kb.organizationId, session.user.id)
    if (!member) {
      return NextResponse.json({ error: 'Not a member of this knowledge base' }, { status: 403 })
    }
  }

  // 4. Resolve target origin (custom domain for KB)
  const targetOrigin = await resolveTrustedAppOrigin(callbackApp, {
    kbId: typeof kbId === 'string' ? kbId : undefined,
  })
  if (!targetOrigin) {
    return NextResponse.json({ error: 'Unknown app' }, { status: 400 })
  }

  // 5. Validate returnTo is a safe relative path
  const safePath = sanitizeReturnTo(returnTo)

  // 6. Issue login token
  const result = await issueLoginToken({
    userId: session.user.id,
    email: session.user.email,
    targetOrigin,
    issuerOrigin: WEBAPP_URL,
    returnTo: safePath,
  })

  if (result.isErr()) {
    return NextResponse.json({ error: result.error.message }, { status: 500 })
  }

  return NextResponse.json({
    loginToken: result.value.token,
    redirectUrl: `${targetOrigin}/auth/verify?loginToken=${result.value.token}`,
  })
}
