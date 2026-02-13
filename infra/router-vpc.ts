import { domain } from './dns'

export const vpc = new sst.aws.Vpc('AuxxAiVpc', { bastion: true, nat: 'ec2' })

// Import existing CloudFront distribution
// export const router = sst.aws.Router.get('AuxxAiRouter', 'E1UUUL5E15V4KL')

export const cluster = new sst.aws.Cluster('AuxxAiCluster', { vpc })
// new router is this: E1UUUL5E15V4KL
export const router = new sst.aws.Router('AuxxAiRouter', {
  domain: {
    name: domain,
    aliases: [`*.${domain}`],
    dns: false,
    cert: 'arn:aws:acm:us-east-1:716542960845:certificate/24d1e0f6-6151-42c4-9ac9-d287bde1aa12',
  },
})

// return {
//   routerDistribution: router.distributionID,
//   routerUrl: router.url,
// }
