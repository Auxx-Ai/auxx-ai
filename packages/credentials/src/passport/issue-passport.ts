// packages/credentials/src/passport/issue-passport.ts

import { SignJWT } from 'jose'
import { err, ok, type Result } from 'neverthrow'
import { configService } from '../config'
import type {
  BasePassportPayload,
  PassportError,
  PassportIssuanceResult,
  PassportScope,
} from './types'

const DEFAULT_EXPIRY = '7d'

/**
 * Read the shared passport signing secret.
 *
 * NOTE: The env var is historically named `PUBLIC_WORKFLOW_JWT_SECRET` but is
 * reused across all passport scopes (workflow + chat). Renaming would require
 * coordinated deployment env changes — not worth it for the name.
 */
function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(
    configService.get<string>('PUBLIC_WORKFLOW_JWT_SECRET') || 'public-workflow-secret-change-me'
  )
}

/**
 * Issue a scope-discriminated JWT passport.
 *
 * @param options.scope - Passport scope (e.g. 'workflow', 'chat')
 * @param options.subjectId - JWT `sub` claim — the subject identity (endUserId, visitorParticipantId, …)
 * @param options.claims - Scope-specific claims merged into the payload
 * @param options.expiresIn - jose expiry syntax (e.g. '7d', '1h'). Defaults to 7 days.
 */
export async function issuePassport<TPayload extends BasePassportPayload>(options: {
  scope: TPayload['scope']
  subjectId: string
  claims: Omit<TPayload, keyof BasePassportPayload>
  expiresIn?: string
}): Promise<Result<PassportIssuanceResult<TPayload>, PassportError>> {
  const { scope, subjectId, claims, expiresIn = DEFAULT_EXPIRY } = options

  try {
    const payload = {
      sub: subjectId,
      iss: 'auxx' as const,
      scope,
      ...claims,
    } as unknown as Omit<TPayload, 'iat' | 'exp'>

    const token = await new SignJWT(payload as Record<string, unknown>)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(getJwtSecret())

    return ok({ token, expiresIn, payload })
  } catch (error) {
    return err({
      code: 'INVALID_PASSPORT' as const,
      message: `Failed to issue passport: ${(error as Error).message}`,
    })
  }
}

export { getJwtSecret as _getPassportJwtSecret }
export type { PassportScope }
