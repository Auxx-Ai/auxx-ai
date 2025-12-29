import globalExternals from '@fal-works/esbuild-plugin-global-externals'
export function createServerBuildConfig(entryPoint: string) {
  return {
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    plugins: [
      globalExternals({
        '@auxx/sdk': {
          varName: 'AUXX_ROOT_SDK',
          type: 'cjs',
        },
        '@auxx/sdk/server': {
          varName: 'AUXX_SERVER_SDK',
          type: 'cjs',
        },
        '@auxx/sdk/client': {
          varName: 'AUXX_CLIENT_EXTENSION_SDK',
          type: 'cjs',
        },
      }),
    ],
  }
}
