// packages/deployment/src/client.ts

// Only re-export the type — client code should NOT call getDeploymentMode()
// directly because it reads process.env. Clients use the useIsSelfHosted() hook instead.
export type { DeploymentMode } from './index'
