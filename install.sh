#!/bin/bash
# Swynx Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/swynx-io/swynx/main/install.sh | bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO="swynx-io/swynx"
INSTALL_DIR="${SWYNX_INSTALL_DIR:-$HOME/.swynx}"
AI_MODEL="qwen2.5-coder:3b"
DASHBOARD_PORT="${SWYNX_PORT:-8999}"

print_banner() {
  echo ""
  echo -e "${CYAN}"
  echo "   ███████╗██╗    ██╗██╗   ██╗███╗   ██╗██╗  ██╗"
  echo "   ██╔════╝██║    ██║╚██╗ ██╔╝████╗  ██║╚██╗██╔╝"
  echo "   ███████╗██║ █╗ ██║ ╚████╔╝ ██╔██╗ ██║ ╚███╔╝ "
  echo "   ╚════██║██║███╗██║  ╚██╔╝  ██║╚██╗██║ ██╔██╗ "
  echo "   ███████║╚███╔███╔╝   ██║   ██║ ╚████║██╔╝ ██╗"
  echo "   ╚══════╝ ╚══╝╚══╝    ╚═╝   ╚═╝  ╚═══╝╚═╝  ╚═╝"
  echo -e "${NC}"
  echo "   Dead code detection that learns"
  echo ""
}

stop_existing() {
  # Kill any existing dashboard processes
  pkill -f "node.*dashboard" 2>/dev/null || true
  pkill -f "swynx.*dashboard" 2>/dev/null || true
  fuser -k $DASHBOARD_PORT/tcp 2>/dev/null || true
  sleep 1
}

check_node() {
  if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is required but not installed.${NC}"
    echo ""
    echo "Install Node.js 18+ from: https://nodejs.org"
    echo "Or use nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    exit 1
  fi

  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18+ required. Found: $(node -v)${NC}"
    exit 1
  fi

  echo -e "${GREEN}✓ Node.js $(node -v)${NC}"
}

install_swynx() {
  echo -e "${BLUE}Installing Swynx...${NC}"

  # Remove old installation
  rm -rf "$INSTALL_DIR"

  # Clone repository
  git clone --depth 1 "https://github.com/${REPO}.git" "$INSTALL_DIR" 2>/dev/null

  # Install dependencies
  cd "$INSTALL_DIR"
  npm install --production --silent

  echo -e "${GREEN}✓ Swynx installed${NC}"
}

setup_path() {
  WRAPPER_DIR="$HOME/.local/bin"
  mkdir -p "$WRAPPER_DIR"

  # Create wrapper script
  cat > "$WRAPPER_DIR/swynx" << EOF
#!/bin/bash
exec node "$INSTALL_DIR/bin/swynx" "\$@"
EOF
  chmod +x "$WRAPPER_DIR/swynx"

  # Add to PATH in both .bashrc and .zshrc
  PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'

  for RC_FILE in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$RC_FILE" ]; then
      if ! grep -q '.local/bin' "$RC_FILE" 2>/dev/null; then
        echo '' >> "$RC_FILE"
        echo '# Swynx' >> "$RC_FILE"
        echo "$PATH_LINE" >> "$RC_FILE"
      fi
    fi
  done

  # Export for current session
  export PATH="$WRAPPER_DIR:$PATH"
  echo -e "${GREEN}✓ PATH configured${NC}"
}

wait_for_engine() {
  # Wait for API to be ready (max 30 seconds)
  for i in {1..30}; do
    if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

spinner() {
  local pid=$1
  local delay=0.2
  local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  local elapsed=0
  while ps -p $pid > /dev/null 2>&1; do
    local char="${spinstr:$i:1}"
    printf "\r  ${CYAN}%s${NC} Warming AI (${elapsed}s)... first run takes 1-2 min on CPU" "$char"
    i=$(( (i + 1) % ${#spinstr} ))
    elapsed=$((elapsed + 1))
    sleep 1
  done
  printf "\r\033[K"
}

install_ai_engine() {
  echo -e "${BLUE}Installing Swynx Engine...${NC}"

  # Install engine runtime if missing
  if ! command -v ollama &> /dev/null; then
    echo "  Installing runtime..."
    curl -fsSL https://ollama.com/install.sh 2>/dev/null | sh > /dev/null 2>&1
  fi

  # Wait for engine API to be available
  echo "  Starting engine..."
  if ! wait_for_engine; then
    # Try starting manually if systemd didn't work
    nohup ollama serve > /dev/null 2>&1 &
    sleep 3
    if ! wait_for_engine; then
      echo -e "${YELLOW}⚠ Engine not ready - AI will warm on first use${NC}"
      return 0
    fi
  fi

  # Download AI model if not present
  if ! ollama list 2>/dev/null | grep -q "qwen2.5-coder"; then
    echo "  Downloading model (~1.8GB)..."
    ollama pull "$AI_MODEL"
  fi

  # Pre-warm the model with progress indicator (max 120s)
  echo ""
  (timeout 120 curl -s http://127.0.0.1:11434/api/generate -d '{"model":"qwen2.5-coder:3b","prompt":"hi","stream":false}' > /dev/null 2>&1) &
  local warm_pid=$!
  spinner $warm_pid
  wait $warm_pid 2>/dev/null

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Swynx Engine ready${NC}"
  else
    echo -e "${YELLOW}⚠ AI warming in background - will be ready shortly${NC}"
  fi
}

start_dashboard() {
  echo -e "${BLUE}Starting Dashboard...${NC}"

  # Start dashboard in background
  cd "$INSTALL_DIR"
  nohup node bin/swynx dashboard --port $DASHBOARD_PORT > /tmp/swynx-dashboard.log 2>&1 &

  # Wait for dashboard to be ready
  for i in {1..10}; do
    if curl -s "http://127.0.0.1:$DASHBOARD_PORT/api/health" > /dev/null 2>&1; then
      echo -e "${GREEN}✓ Dashboard running${NC}"
      return 0
    fi
    sleep 1
  done

  echo -e "${YELLOW}⚠ Dashboard may still be starting...${NC}"
}

print_success() {
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

  echo ""
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Swynx is ready!${NC}"
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  Dashboard: ${BLUE}http://${LOCAL_IP}:${DASHBOARD_PORT}${NC}"
  echo ""
  echo "  CLI commands:"
  echo -e "    ${CYAN}swynx scan .${NC}              # Basic scan"
  echo -e "    ${CYAN}swynx scan . --qualify${NC}   # With AI analysis"
  echo ""
  echo -e "  Docs: ${BLUE}https://github.com/swynx-io/swynx${NC}"
  echo ""
}

# Main
print_banner
stop_existing
check_node
install_swynx
setup_path
install_ai_engine
start_dashboard
print_success
