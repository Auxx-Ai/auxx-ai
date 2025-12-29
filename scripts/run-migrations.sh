#!/bin/bash
# scripts/run-migrations.sh
# Run database migrations after SST deployment

echo "🚀 Running database migrations..."

# Check if we're in the right directory
if [ ! -f "sst.config.ts" ]; then
  echo "❌ Error: Must be run from project root (where sst.config.ts is)"
  exit 1
fi

# Check if stage is provided
STAGE=${1:-dev}
echo "📦 Running migrations for stage: $STAGE"

# Use sst shell to run migrations with proper database connection
echo "🔄 Executing migrations via sst shell..."
npx sst shell --stage $STAGE \
  --target AuxxAiRds \
  pnpm --filter @auxx/db run db:migrate:deploy

if [ $? -eq 0 ]; then
  echo "✅ Migrations completed successfully!"
else
  echo "❌ Migration failed!"
  exit 1
fi