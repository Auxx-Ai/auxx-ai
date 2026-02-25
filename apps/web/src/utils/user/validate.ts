// apps/web/src/utils/user/validate.ts

import { getUserById } from '@auxx/lib/users'

export async function validateUserAndAiAccess(userId: string) {
  const found = await getUserById(userId)
  const user = found
    ? {
        id: found.id,
        email: (found as any).email,
        aiProvider: (found as any).aiProvider,
        aiModel: (found as any).aiModel,
        aiApiKey: (found as any).aiApiKey,
      }
    : null
  if (!user) return { error: 'User not found' }

  const userHasAiAccess = hasAiAccess(
    // user.premium?.aiAutomationAccess,
    user.aiApiKey
  )
  if (!userHasAiAccess) return { error: 'Please upgrade for AI access' }

  return { user }
}

export const hasAiAccess = (
  // aiAutomationAccess?: FeatureAccess | null,
  aiApiKey?: string | null
) => {
  return true
  // const hasAiAccess = !!(
  //   aiAutomationAccess === FeatureAccess.UNLOCKED ||
  //   (aiAutomationAccess === FeatureAccess.UNLOCKED_WITH_API_KEY && aiApiKey)
  // )

  // return hasAiAccess
}
