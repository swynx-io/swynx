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
DASHBOARD_PORT="${SWYNX_PORT:-8999}"

print_banner() {
  echo ""
  echo -e "${CYAN}"
  echo "    ..............      .....      ........       ........  ........ ......     ......"
  echo "  .................    .......    ..........     ............................  ......"
  echo "  .....    .........  .........   ..........    ..... ......     ...... ..........."
  echo "  ...........  .....  .......... .....  .....  ...... ....       ......   ......."
  echo "     .....................  .........    ..... .....  ....       ......   ......."
  echo "  .....    ..............   ........      .........   ....       ...... ..........."
  echo "  ..............  .......    .......       .......    ....       ............  ......"
  echo "    ...........    .....     ......         .....     ....       ..........     ......."
  echo "                                           ....."
  echo "                                          ....."
  echo "                                         ....."
  echo -e "${NC}"
  echo "  Continuous codebase intelligence across 26 languages"
  echo ""
}

stop_existing() {
  # Kill any existing dashboard processes
  pkill -f "node.*dashboard" 2>/dev/null || true
  pkill -f "swynx.*dashboard" 2>/dev/null || true
  # Kill process on port (macOS compatible)
  if command -v lsof &> /dev/null; then
    lsof -ti:$DASHBOARD_PORT | xargs kill -9 2>/dev/null || true
  elif command -v fuser &> /dev/null; then
    fuser -k $DASHBOARD_PORT/tcp 2>/dev/null || true
  fi
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
  echo ""
  echo -e "${BLUE}Installing Swynx...${NC}"
  echo ""

  # Remove old installation
  if [ -d "$INSTALL_DIR" ]; then
    echo -e "  Removing previous installation..."
    rm -rf "$INSTALL_DIR"
  fi

  # Clone repository
  echo -e "  Cloning from GitHub..."
  git clone --depth 1 "https://github.com/${REPO}.git" "$INSTALL_DIR" 2>&1 | while read -r line; do
    echo -e "    ${line}"
  done

  # Install dependencies
  echo -e "  Installing dependencies..."
  cd "$INSTALL_DIR"
  npm install --production 2>&1 | tail -3 | while read -r line; do
    echo -e "    ${line}"
  done

  echo ""
  echo -e "${GREEN}✓ Swynx installed to ${INSTALL_DIR}${NC}"
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

start_dashboard() {
  echo -e "${BLUE}Starting Dashboard...${NC}"

  # Start dashboard in background
  cd "$INSTALL_DIR"
  nohup node bin/swynx dashboard --port $DASHBOARD_PORT > /tmp/swynx-dashboard.log 2>&1 &
  local dash_pid=$!

  # Wait for dashboard to be ready (up to 15 seconds)
  for i in {1..15}; do
    # Check if process died
    if ! kill -0 $dash_pid 2>/dev/null; then
      echo -e "${RED}✗ Dashboard failed to start${NC}"
      if [ -f /tmp/swynx-dashboard.log ]; then
        echo ""
        echo "Error log:"
        tail -20 /tmp/swynx-dashboard.log
      fi
      return 1
    fi
    # Check if responding
    if curl -s "http://127.0.0.1:$DASHBOARD_PORT/api/health" > /dev/null 2>&1; then
      echo -e "${GREEN}✓ Dashboard running${NC}"
      return 0
    fi
    sleep 1
  done

  # Still running but not responding - something's wrong
  echo -e "${RED}✗ Dashboard not responding${NC}"
  echo ""
  echo "Log output:"
  tail -20 /tmp/swynx-dashboard.log
  return 1
}

print_success() {
  # Get local IP (macOS and Linux compatible)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
  else
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
  fi

  echo ""
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Swynx is ready!${NC}"
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  Dashboard: ${BLUE}http://${LOCAL_IP}:${DASHBOARD_PORT}${NC}"
  echo ""
  echo "  CLI commands:"
  echo -e "    ${CYAN}swynx scan .${NC}              # Scan current directory"
  echo -e "    ${CYAN}swynx dashboard${NC}           # Open dashboard"
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
start_dashboard
print_success
