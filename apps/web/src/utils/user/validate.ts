// import { hasAiAccess } from '@/utils/premium'
// import prisma from '@/utils/prisma'

import { UserModel } from '@auxx/database/models'

export async function validateUserAndAiAccess(userId: string) {
  const userModel = new UserModel()
  const res = await userModel.findById(userId)
  const user = res.ok
    ? res.value && {
        id: res.value.id,
        email: (res.value as any).email,
        aiProvider: (res.value as any).aiProvider,
        aiModel: (res.value as any).aiModel,
        aiApiKey: (res.value as any).aiApiKey,
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
