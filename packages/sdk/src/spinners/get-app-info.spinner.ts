import { api } from '../api/api.js'
// import type { ApiError } from '../api/api.js'
import { spinnerify } from '../util/spinner.js'
// import type { Result } from '../types/result.js'

// export type App = {
//   id: string
//   slug: string
//   title: string
//   description: string | null
//   developerAccountId: string
//   avatarId: string | null
//   avatarUrl: string | null
//   category: string | null
//   createdAt: string | Date
//   updatedAt: string | Date
// }

/**
 * Get app information by slug
 */
export async function getAppInfo(appSlug: string) {
  return await spinnerify(
    'Loading app information...',
    (app) => `App found: ${app.title}`,
    async () => {
      return await api.fetchAppInfo(appSlug)
    }
  )
}
