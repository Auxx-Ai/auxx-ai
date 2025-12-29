export function getPackageManagerCommand(command: string) {
  const packageManager = process.env.npm_config_user_agent?.split('/')?.[0]
  return (
    {
      npm: `npm run ${command}`,
      yarn: `yarn ${command}`,
      pnpm: `pnpm ${command}`,
      bun: `bun run ${command}`,
    }[packageManager ?? 'npm'] ?? `npm run ${command}`
  )
}
