// packages/credentials/src/passport/verify-workflow-passport.ts

import type { Result } from 'neverthrow'
import type { PassportError, VerifiedWorkflowPassport } from './types'
import { verifyPassport } from './verify-passport'

/**
 * Verify a workflow-scoped JWT passport token.
 *
 * Thin wrapper around the generic {@link verifyPassport} that asserts `scope === 'workflow'`.
 */
export async function verifyWorkflowPassport(
  token: string
): Promise<Result<VerifiedWorkflowPassport, PassportError>> {
  return verifyPassport(token, 'workflow')
}
