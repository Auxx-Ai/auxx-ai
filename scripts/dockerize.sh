#!/bin/bash
# scripts/dockerize.sh
# Main orchestration script for Docker operations

set -e

# Default values
COMMAND="build"
ENVIRONMENT="development"
APP="all"
TAG="latest"
PUSH_REGISTRY=""
COMPOSE_ACTION=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to show help
show_help() {
    cat << EOF
Usage: ./scripts/dockerize.sh [OPTIONS]

Options:
    -b, --build              Build Docker images (default)
    -r, --run                Run containers after building
    -p, --push REGISTRY      Push images to registry
    -e, --env ENV            Environment (development|staging|production)
    -a, --app APP            Specific app (web|worker|docs|kb|all)
    -t, --tag TAG            Docker image tag (default: latest)
    -c, --compose ACTION     Docker Compose action (up|down|restart|logs|ps)
    -h, --help               Show this help message

Examples:
    # Build all apps for development
    ./scripts/dockerize.sh --build --env development

    # Build and run specific app
    ./scripts/dockerize.sh --run --app web --env production

    # Push all images to registry
    ./scripts/dockerize.sh --push registry.example.com --tag v1.0.0

    # Use docker-compose
    ./scripts/dockerize.sh --compose up --env development
    
    # View logs for all services
    ./scripts/dockerize.sh --compose logs --env development
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --build|-b)
            COMMAND="build"
            shift
            ;;
        --run|-r)
            COMMAND="run"
            shift
            ;;
        --push|-p)
            COMMAND="push"
            PUSH_REGISTRY="$2"
            shift 2
            ;;
        --env|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --app|-a)
            APP="$2"
            shift 2
            ;;
        --tag|-t)
            TAG="$2"
            shift 2
            ;;
        --compose|-c)
            COMMAND="compose"
            COMPOSE_ACTION="$2"
            shift 2
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Main logic
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_SCRIPTS="$PROJECT_ROOT/scripts/docker"

# Ensure docker scripts have execute permissions
chmod +x "$DOCKER_SCRIPTS"/*.sh 2>/dev/null || true

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        echo -e "${RED}Error: Docker is not running or not installed${NC}"
        echo "Please start Docker and try again"
        exit 1
    fi
}

# Check Docker before proceeding
check_docker

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Auxx.ai Docker Management${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""

case $COMMAND in
    build)
        echo -e "${YELLOW}Building Docker images...${NC}"
        echo "Environment: $ENVIRONMENT"
        echo "App: $APP"
        echo "Tag: $TAG"
        echo ""
        
        if [ "$APP" = "all" ]; then
            "$DOCKER_SCRIPTS/build-all.sh" "$ENVIRONMENT" true "$TAG"
        else
            "$DOCKER_SCRIPTS/build-app.sh" "$APP" "$ENVIRONMENT" true "$TAG"
        fi
        ;;
        
    run)
        echo -e "${YELLOW}Building and running containers...${NC}"
        echo "Environment: $ENVIRONMENT"
        echo "App: $APP"
        echo ""
        
        if [ "$APP" = "all" ]; then
            # Use docker-compose for running all services
            COMPOSE_FILE="docker-compose.$ENVIRONMENT.yml"
            if [ ! -f "$PROJECT_ROOT/$COMPOSE_FILE" ]; then
                COMPOSE_FILE="docker-compose.yml"
            fi
            
            echo "Using compose file: $COMPOSE_FILE"
            docker-compose -f "$PROJECT_ROOT/$COMPOSE_FILE" up -d
        else
            "$DOCKER_SCRIPTS/build-app.sh" "$APP" "$ENVIRONMENT" false "$TAG"
        fi
        ;;
        
    push)
        if [ -z "$PUSH_REGISTRY" ]; then
            echo -e "${RED}Error: Registry URL required for push operation${NC}"
            echo "Usage: ./scripts/dockerize.sh --push <registry-url>"
            exit 1
        fi
        
        echo -e "${YELLOW}Pushing images to $PUSH_REGISTRY...${NC}"
        apps=("web" "worker" "docs" "kb")
        
        for app in "${apps[@]}"; do
            if [ "$APP" = "all" ] || [ "$APP" = "$app" ]; then
                local_image="auxx-ai-$app:$TAG"
                remote_image="$PUSH_REGISTRY/auxx-ai-$app:$TAG"
                
                if docker image inspect "$local_image" > /dev/null 2>&1; then
                    echo "Tagging $local_image as $remote_image"
                    docker tag "$local_image" "$remote_image"
                    
                    echo "Pushing $remote_image"
                    docker push "$remote_image"
                    echo -e "${GREEN}✅ Pushed $app${NC}"
                else
                    echo -e "${YELLOW}⚠️  Image $local_image not found, skipping${NC}"
                fi
            fi
        done
        ;;
        
    compose)
        if [ -z "$COMPOSE_ACTION" ]; then
            echo -e "${RED}Error: Compose action required${NC}"
            echo "Usage: ./scripts/dockerize.sh --compose <action>"
            exit 1
        fi
        
        COMPOSE_FILE="docker-compose.$ENVIRONMENT.yml"
        if [ ! -f "$PROJECT_ROOT/$COMPOSE_FILE" ]; then
            if [ "$ENVIRONMENT" = "development" ] && [ -f "$PROJECT_ROOT/docker-compose.dev.yml" ]; then
                COMPOSE_FILE="docker-compose.dev.yml"
            elif [ "$ENVIRONMENT" = "production" ] && [ -f "$PROJECT_ROOT/docker-compose.prod.yml" ]; then
                COMPOSE_FILE="docker-compose.prod.yml"
            else
                COMPOSE_FILE="docker-compose.yml"
            fi
        fi
        
        echo -e "${YELLOW}Running docker-compose $COMPOSE_ACTION...${NC}"
        echo "Using compose file: $COMPOSE_FILE"
        echo ""
        
        case $COMPOSE_ACTION in
            up)
                docker-compose -f "$PROJECT_ROOT/$COMPOSE_FILE" up -d
                echo -e "${GREEN}Services started${NC}"
                docker-compose -f "$PROJECT_ROOT/$COMPOSE_FILE" ps
                ;;
            down)
                docker-compose -f "$PROJECT_ROOT/$COMPOSE_FILE" down
                echo -e "${GREEN}Services stopped${NC}"
                ;;
            restart)
                docker-compose -f "$PROJECT_ROOT/$COMPOSE_FILE" restart
                echo -e "${GREEN}Services restarted${NC}"
                ;;
            logs)
                docker-compose -f "$PROJECT_ROOT/$COMPOSE_FILE" logs -f
                ;;
            ps)
                docker-compose -f "$PROJECT_ROOT/$COMPOSE_FILE" ps
                ;;
            *)
                docker-compose -f "$PROJECT_ROOT/$COMPOSE_FILE" $COMPOSE_ACTION
                ;;
        esac
        ;;
        
    *)
        echo -e "${RED}Invalid command${NC}"
        show_help
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Operation completed successfully!${NC}"
echo -e "${GREEN}=========================================${NC}"