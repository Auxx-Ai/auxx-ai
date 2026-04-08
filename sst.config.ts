/// <reference path="./.sst/platform/config.d.ts" />

type Region = 'us-west-1' | undefined

export default $config({
  app(input) {
    return {
      name: 'auxxai-app',
      home: 'aws',
      providers: {
        aws: {
          ...(!process.env.GITHUB_ACTIONS && {
            profile: input.stage === 'production' ? 'auxxai-prod' : 'auxxai-dev',
          }),
          region: (process.env.AWS_REGION || 'us-west-1') as Region,
        },
      },
    }
  },
  async run() {
    const infra = await import('./infra')

    return {
      router: infra.router?.distributionID,
      routerDistribution: infra.router?.distributionID,
      routerUrl: infra.router?.url,
      databaseDeployFunctionName: infra.databaseDeployFunction?.name,
    }
  },
})
