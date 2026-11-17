#!/usr/bin/env bash

# ==============================================================================
# EntangledEcho - All-in-One Service Launcher
# Runs the Web frontend, Express API + Scraper Worker, and Python ML Service.
# ==============================================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Terminal Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}==================================================================${NC}"
echo -e "${CYAN}           🌌 Starting EntangledEcho Full-Stack System            ${NC}"
echo -e "${CYAN}==================================================================${NC}"

# 1. Ensure required storage directories exist locally
mkdir -p storage/profiles storage/posts storage/post-media storage/models storage/model-artifacts/global storage/model-artifacts/personal

# 2. Cleanup stale processes on ports 3000, 4000, and 8001
cleanup_ports() {
    for port in 3000 4000 8001; do
        if command -v fuser >/dev/null 2>&1; then
            if fuser $port/tcp >/dev/null 2>&1; then
                echo -e "${YELLOW}Freeing port :$port...${NC}"
                fuser -k -9 $port/tcp >/dev/null 2>&1 || true
            fi
        fi
        local pids
        pids=$(lsof -ti :$port 2>/dev/null || true)
        if [ -n "$pids" ]; then
            for p in $pids; do
                kill -9 "$p" 2>/dev/null || true
            done
        fi
        # Wait up to 3 seconds for port to actually be released by the kernel
        local count=0
        while (fuser $port/tcp >/dev/null 2>&1 || lsof -ti :$port >/dev/null 2>&1) && [ $count -lt 30 ]; do
            sleep 0.1
            count=$((count + 1))
        done
    done
}

cleanup_ports

# 3. Trap exit signals to gracefully terminate all child background processes
cleanup_processes() {
    echo ""
    echo -e "${YELLOW}🛑 Shutting down EntangledEcho services cleanly...${NC}"
    if [ -n "$PID_ML" ]; then kill -SIGTERM "$PID_ML" 2>/dev/null || true; fi
    if [ -n "$PID_API" ]; then kill -SIGTERM "$PID_API" 2>/dev/null || true; fi
    if [ -n "$PID_WEB" ]; then kill -SIGTERM "$PID_WEB" 2>/dev/null || true; fi
    sleep 0.5
    # Force kill if any linger
    cleanup_ports
    echo -e "${GREEN}✓ All services stopped.${NC}"
    exit 0
}

trap cleanup_processes SIGINT SIGTERM EXIT

# 4. Check whether to run in dev mode or production build mode
MODE="start"
if [ "$1" = "dev" ]; then
    MODE="dev"
    echo -e "${BLUE}Mode: Development (Live reload enabled)${NC}"
else
    MODE="start"
    echo -e "${BLUE}Mode: Production/Standard (Fast start)${NC}"
    # Verify web production build exists (check BUILD_ID)
    if [ ! -f "apps/web/.next/BUILD_ID" ]; then
        echo -e "${YELLOW}Building Web frontend for production...${NC}"
        NEXT_IGNORE_INCORRECT_LOCKFILE=1 pnpm --filter web build
    fi
fi

# 5. Start Python ML Service (Port 8001)
echo -e "${GREEN}[1/3] Launching Python ML Service on http://localhost:8001 ...${NC}"
python3 -m uvicorn main:app --app-dir services/ml --host 0.0.0.0 --port 8001 &
PID_ML=$!

# 6. Start API & Scraper Worker (Port 4000)
echo -e "${GREEN}[2/3] Launching API & Local Scraper Worker on http://localhost:4000 ...${NC}"
if [ "$MODE" = "dev" ]; then
    pnpm --filter api dev &
else
    pnpm --filter api start &
fi
PID_API=$!

# 7. Start Web Next.js Frontend (Port 3000)
echo -e "${GREEN}[3/3] Launching Web Frontend on http://localhost:3000 ...${NC}"
if [ "$MODE" = "dev" ]; then
    pnpm --filter web dev &
else
    pnpm --filter web start &
fi
PID_WEB=$!

# Wait 2 seconds and check process liveness
sleep 2

FAILED_SERVICE=0
for pid in "$PID_ML" "$PID_API" "$PID_WEB"; do
    if ! kill -0 "$pid" 2>/dev/null; then
        FAILED_SERVICE=1
    fi
done

if [ "$FAILED_SERVICE" -eq 1 ]; then
    echo ""
    echo -e "${RED}⚠️  One or more services failed to start! Check the error logs above.${NC}"
    exit 1
fi

echo ""
echo -e "${CYAN}==================================================================${NC}"
echo -e "${GREEN}✓ All 3 EntangledEcho services are up and running!${NC}"
echo -e "${CYAN}------------------------------------------------------------------${NC}"
echo -e " 🌐 ${GREEN}Web App:${NC}      http://localhost:3000"
echo -e " 🛡️  ${GREEN}Admin Panel:${NC}  http://localhost:3000/admin  (Password: admin123)"
echo -e " ⚙️  ${GREEN}API Server:${NC}   http://localhost:4000"
echo -e " 🤖 ${GREEN}ML Engine:${NC}    http://localhost:8001"
echo -e "${CYAN}==================================================================${NC}"
echo -e "${YELLOW}Press [CTRL+C] at any time to stop all services.${NC}"
echo ""

# Keep running and monitor processes
wait
