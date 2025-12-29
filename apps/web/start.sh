#!/bin/sh
# apps/web/start.sh
# Simple startup script to run migrations before starting the server

echo "🚀 Starting production server..."

# Only run migrations in production SST environment
if [ "$SST" = "1" ] && [ "$NODE_ENV" = "production" ]; then
  echo "📦 Production environment detected, running migrations..."
  
  # Try to run migrations from the db package
  if [ -d "/app/packages/db" ]; then
    cd /app/packages/db
    npx prisma migrate deploy --config prisma.config.ts || echo "⚠️ Migration failed, continuing anyway..."
    cd /app/apps/web
  else
    echo "⚠️ DB package not found, skipping migrations"
  fi
fi

# Start the Next.js server
echo "🌐 Starting Next.js server..."
exec node server.js