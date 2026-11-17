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
        # Method A: fuser directly frees bound TCP sockets (both IPv4 & IPv6)
        if command -v fuser >/dev/null 2>&1; then
            pids=$(fuser "${port}/tcp" 2>/dev/null || true)
            if [ -n "$pids" ]; then
                echo -e "${YELLOW}Freeing port :$port (terminating PIDs:$pids)...${NC}"
                fuser -k -9 "${port}/tcp" 2>/dev/null || true
            fi
        fi

        # Method B: ss / lsof fallback specifically for LISTEN sockets
        if command -v ss >/dev/null 2>&1; then
            ss_pids=$(ss -lptn "sport = :${port}" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)
            if [ -n "$ss_pids" ]; then
                for p in $ss_pids; do
                    echo -e "${YELLOW}Freeing port :$port (terminating PID: $p)...${NC}"
                    kill -9 "$p" 2>/dev/null || true
                done
            fi
        elif command -v lsof >/dev/null 2>&1; then
            lsof_pids=$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)
            if [ -n "$lsof_pids" ]; then
                for p in $lsof_pids; do
                    echo -e "${YELLOW}Freeing port :$port (terminating PID: $p)...${NC}"
                    kill -9 "$p" 2>/dev/null || true
                done
            fi
        fi
    done
    sleep 0.5
}

cleanup_ports

# 3. Trap exit signals to gracefully terminate all child background processes
cleanup_processes() {
    # Unset trap to prevent recursive calls on exit
    trap - SIGINT SIGTERM EXIT
    echo ""
    echo -e "${YELLOW}🛑 Shutting down EntangledEcho services cleanly...${NC}"

    # Terminate process trees of child jobs to avoid orphaned server processes
    for pid in "$PID_WEB" "$PID_API" "$PID_ML"; do
        if [ -n "$pid" ]; then
            pkill -P "$pid" 2>/dev/null || true
            kill -SIGTERM "$pid" 2>/dev/null || true
        fi
    done

    sleep 0.3

    for pid in "$PID_WEB" "$PID_API" "$PID_ML"; do
        if [ -n "$pid" ]; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    done

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

# Wait 3 seconds for initial bindings
sleep 3

# Verify background processes are actually alive
FAILED=0
if ! kill -0 "$PID_ML" 2>/dev/null; then
    echo -e "${RED}✗ Python ML Service failed to start on port 8001!${NC}"
    FAILED=1
fi
if ! kill -0 "$PID_API" 2>/dev/null; then
    echo -e "${RED}✗ API & Local Scraper Worker failed to start on port 4000!${NC}"
    FAILED=1
fi
if ! kill -0 "$PID_WEB" 2>/dev/null; then
    echo -e "${RED}✗ Web Frontend failed to start on port 3000!${NC}"
    FAILED=1
fi

if [ "$FAILED" -eq 1 ]; then
    echo -e "${RED}Startup aborted: one or more services crashed. Check logs above.${NC}"
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
