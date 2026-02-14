import { env } from '@auxx/config/server'
// import { logErrorToPosthog } from '@/utils/error.server'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { captureException, checkCommonErrors, logErrorToPosthog, SafeError } from '~/utils/error'

// import { auth } from '~/auth/server'
// import { auth } from '~/app/api/auth/[...nextauth]/auth'

const logger = createScopedLogger('middleware')

export type NextHandler = (
  req: NextRequest,
  { params }: { params: Record<string, string | undefined> }
) => Promise<NextResponse | Response>

export function withError(handler: NextHandler): NextHandler {
  return async (req, params) => {
    try {
      return await handler(req, params)
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json(
          { error: { issues: error.issues }, isKnownError: true },
          { status: 400 }
        )
      }

      const apiError = checkCommonErrors(error, req.url)
      if (apiError) {
        await logErrorToPosthog('api', req.url, apiError.type)

        return NextResponse.json(
          { error: apiError.message, isKnownError: true },
          { status: apiError.code }
        )
      }

      if (isErrorWithConfigAndHeaders(error)) {
        error.config.headers = undefined
      }

      if (error instanceof SafeError) {
        return NextResponse.json({ error: error.safeMessage, isKnownError: true }, { status: 400 })
      }

      logger.error('Unhandled error', {
        error,
        url: req.url,
        params,
        email: await getEmailFromRequest(req),
      })
      captureException(error, { extra: { url: req.url, params } })

      return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
    }
  }
}

function isErrorWithConfigAndHeaders(error: unknown): error is { config: { headers: unknown } } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'config' in error &&
    'headers' in (error as { config: any }).config
  )
}

async function getEmailFromRequest(req: NextRequest) {
  try {
    return 'test@auxx.ai'
    // const session = await auth()
    // return session?.user.email
  } catch (error) {
    logger.error('Error getting email from request', { error })
    return null
  }
}
