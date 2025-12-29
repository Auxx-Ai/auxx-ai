import z from 'zod'
import { api } from '../api/api.js'
import { appInfoSchema } from '../api/schemas.js'
import { spinnerify } from '../util/spinner.js'

type AppInfo = z.infer<typeof appInfoSchema>['data']['app']

export async function getVersions(appInfo: AppInfo) {
  return await spinnerify(
    'Loading versions...',
    'Versions loaded',
    async () => await api.fetchVersions(appInfo.id)
  )
}
