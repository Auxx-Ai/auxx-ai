// apps/web/src/app/api/speech/transcribe/route.ts

import { database as db } from '@auxx/database'
import {
  QuotaExceededError,
  Speech2TextOrchestrator,
  type UsageSource,
  UsageTrackingService,
} from '@auxx/lib/ai'
import { UsageLimitError } from '@auxx/lib/errors'
import { createScopedLogger } from '@auxx/logger'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('api-speech-transcribe')

const MAX_BYTES = 25 * 1024 * 1024 // OpenAI whisper-1 cap

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.defaultOrganizationId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = session.user.defaultOrganizationId
  const userId = session.user.id

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = form.get('audio')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'audio field missing or not a file' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'audio is empty' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'audio too large (max 25MB)' }, { status: 413 })
  }

  const language = (form.get('language') as string | null) || undefined
  const source = ((form.get('source') as string | null) || 'compose') as UsageSource

  const buffer = Buffer.from(await file.arrayBuffer())
  const orchestrator = new Speech2TextOrchestrator(new UsageTrackingService(db), db)

  try {
    const result = await orchestrator.transcribe({
      audio: buffer,
      mimeType: file.type || undefined,
      filename: file.name || undefined,
      language,
      organizationId,
      userId,
      context: { source },
    })
    return NextResponse.json({ text: result.text, language: result.language })
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return NextResponse.json({ error: err.message }, { status: 402 })
    }
    if (err instanceof UsageLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    logger.error('Transcription failed', { error: err instanceof Error ? err.message : err })
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
