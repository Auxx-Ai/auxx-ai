#!/bin/sh
# apps/web/scripts/start-server.sh

echo "🚀 Starting production server..."

# Check if we're in SST environment and should run migrations
if [ "$SST" = "1" ]; then
  echo "📦 SST environment detected, checking for pending migrations..."
  
  # Run migrations using Node directly since we might not have tsx in production
  node --loader tsx scripts/runtime-migrate.js
  
  if [ $? -ne 0 ]; then
    echo "⚠️ Migration failed, but continuing to start server..."
  fi
else
  echo "📌 Not in SST environment, skipping migrations"
fi

# Start the Next.js server
echo "🌐 Starting Next.js server..."
exec node server.js