# Docker Setup for Auxx.ai

This guide explains how to run the Auxx.ai turborepo using Docker Compose.

## Prerequisites

- Docker and Docker Compose installed
- `.env` file configured with necessary environment variables

## Services

The Docker Compose setup includes:

- **PostgreSQL** (with pgvector extension) - Database
- **Redis** - Caching and queue management
- **Web** - Main Next.js application (port 3000)
- **Worker** - Background job processor (port 8080)
- **KB** - Knowledge Base application (port 3002)
- **WebSockets** - Real-time communication server (port 4000)
- **Nginx** (production only) - Reverse proxy

## Development Setup

### Quick Start

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

### Individual Service Commands

```bash
# Start specific service
docker-compose up -d web

# Rebuild a service
docker-compose build web

# Access service logs
docker-compose logs -f web

# Execute commands in a service
docker-compose exec web pnpm turbo db:migrate:dev
```

### Database Migrations

```bash

# Access database
docker-compose exec postgres psql -U postgres -d auxx-ai
```

## Production Setup

### Build and Deploy

```bash
# Use production compose file
docker-compose -f docker-compose.prod.yml up -d

# Build with cache (recommended)
docker-compose -f docker-compose.prod.yml build --no-cache

# Scale services
docker-compose -f docker-compose.prod.yml up -d --scale worker=3
```

### Environment Variables

Ensure these are set in your `.env` file:

```bash
DATABASE_PASSWORD=your_secure_password
REDIS_PASSWORD=your_redis_password
TURBO_TEAM=your_turbo_team
TURBO_TOKEN=your_turbo_token
# ... other required variables
```

## Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 3000, 3002, 4000, 5432, 6379 are available
2. **Database connection**: Wait for health checks to pass before accessing services
3. **Volume permissions**: Docker might need proper permissions for volume mounts

### Health Checks

```bash
# Check service health
docker-compose ps

# Test specific service
curl http://localhost:3000/health
```

### Clean Up

```bash
# Remove all containers and networks
docker-compose down

# Remove volumes (WARNING: deletes data)
docker-compose down -v

# Clean up everything including images
docker-compose down --rmi all -v
```

## Development vs Production

### Development (`docker-compose.yml`)

- Volume mounts for hot reloading
- Exposed ports on all interfaces
- Development environment variables
- No resource limits

### Production (`docker-compose.prod.yml`)

- No source code volumes
- Restricted port exposure (localhost only for DB/Redis)
- Production environment variables
- Resource limits and reservations
- Nginx reverse proxy included
- Persistent Redis configuration

## Monitoring

```bash
# View resource usage
docker stats

# Check container health
docker-compose ps

# View network
docker network ls
```

## Backup

```bash
# Backup PostgreSQL
docker-compose exec postgres pg_dump -U postgres auxx-ai > backup.sql

# Backup Redis
docker-compose exec redis redis-cli --rdb /data/dump.rdb
```
