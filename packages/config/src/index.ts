// export const env = process.env.NEXT_RUNTIME === 'nodejs' ? require('./env').env : ({} as const)
// console.log('env', process.env.NEXT_RUNTIME)
// export { env } from './test'
// export { themes } from './themes';

// Export SST resource helpers
export { getSecrets, getSecret } from './sst-resources'
export { env } from './env'

// Export timezone utilities
export { IANA_TIME_ZONES, detectTimezone, isValidTimezone, type IANATimeZone } from './timezones'

// You can also create a default export with everything
// const config = {
//   env: { ...import('./env').then((m) => m.env) },
//   features: { ...import('./features').then((m) => m.features) },
//   constants: { ...import('./constants').then((m) => m.constants) },
//   clientEnv: { ...import('./client-env').then((m) => m.clientEnv) },
//   // themes: { ...import('./themes').then(m => m.themes) },
// }
