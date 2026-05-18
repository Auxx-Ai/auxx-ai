# Ops Reference — Railway (production) & AWS (dev)

Reference commands for production and dev infrastructure debugging. Read this file when working with Railway, AWS logs, ECS, RDS, or production deploys.

---

## Railway CLI (production)

The project is linked to Railway via `railway link`. The `.railway` config file is gitignored.

**Workspace:** Auxx.Ai's Projects | **Project:** Auxx Ai | **Environment:** production

**Services:** web, api, worker, build, lambda-server, homepage, docs, Postgres, pgvector, Redis

```bash
# List all projects
railway list

# Show all services and their deployment status
railway service status -a --json

# View variables for a specific service
railway variables -s <service-name> --json

# View logs for a specific service
railway service logs -s <service-name>

# Redeploy a service
railway service redeploy -s <service-name>
```

---

## AWS Debugging (dev)

**Region:** `us-west-1` | **Profile:** `auxxai-dev`

```bash
# Login (if SSO session expired)
aws sso login --profile auxxai-dev

# NOTE: Log group suffixes (e.g. -takkzbrr) change on each deploy.
# Use `aws logs describe-log-groups` to find current names:
aws logs describe-log-groups --profile auxxai-dev --region us-west-1 --log-group-name-prefix "/aws/lambda/auxxai-app-dev" --query 'logGroups[*].logGroupName' --output table

# Tail logs (add --follow for live streaming)
# Worker (BullMQ jobs) — find current log group:
aws logs describe-log-groups --profile auxxai-dev --region us-west-1 --log-group-name-prefix "/sst/cluster/auxxai-app-dev" --query 'logGroups[*].logGroupName' --output text
# Web server (Next.js SSR) — find current log group:
aws logs describe-log-groups --profile auxxai-dev --region us-west-1 --log-group-name-prefix "/aws/lambda/auxxai-app-dev-AuxxAiWebServer" --query 'logGroups[*].logGroupName' --output text
# Then tail with:
# aws logs tail "<log-group-name>" --profile auxxai-dev --region us-west-1 --since 1h

# Search logs for errors
aws logs filter-log-events --log-group-name "<log-group>" --filter-pattern "ERROR" --start-time $(date -v-1H +%s000) --profile auxxai-dev --region us-west-1

# ECS worker status — cluster suffix also changes on deploy:
# aws ecs list-clusters --profile auxxai-dev --region us-west-1
aws ecs describe-services --cluster <cluster-name> --services AuxxAiWorker --profile auxxai-dev --region us-west-1

# RDS status
aws rds describe-db-instances --profile auxxai-dev --region us-west-1 --query 'DBInstances[0].{Status:DBInstanceStatus,Endpoint:Endpoint.Address}'
```
