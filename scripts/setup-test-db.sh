#!/bin/bash
set -e

# Setup test databases for auxxai
# Usage: ./scripts/setup-test-db.sh

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

echo "🗄️  Setting up test databases..."
echo ""

# Create development database (if not using docker-compose)
echo "📦 Creating development database: auxx-ai"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c 'CREATE DATABASE "auxx-ai";' 2>/dev/null || echo "   ↳ (already exists)"

# Create test database
echo "📦 Creating test database: auxx_test"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c 'CREATE DATABASE "auxx_test";' 2>/dev/null || echo "   ↳ (already exists)"

echo ""
echo "✅ Databases ready"
echo ""
echo "Next steps:"
echo "  1. Run: pnpm install"
echo "  2. Run: pnpm db:migrate"
echo "  3. Run: pnpm seed:dev (optional, for development data)"
echo "  4. Run: pnpm dev"
