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

  echo -e "${GREEN}✓ Node.js $(node -v) detected${NC}"
}

install_swynx() {
  echo -e "${BLUE}Installing Swynx...${NC}"

  # Remove old installation
  rm -rf "$INSTALL_DIR"

  # Clone repository
  echo "Cloning from GitHub..."
  git clone --depth 1 "https://github.com/${REPO}.git" "$INSTALL_DIR" 2>/dev/null

  # Install dependencies
  echo "Installing dependencies..."
  cd "$INSTALL_DIR"
  npm install --production --silent

  echo -e "${GREEN}✓ Swynx installed to ${INSTALL_DIR}${NC}"
}

setup_path() {
  BIN_PATH="$INSTALL_DIR/bin"

  # Create wrapper script in a standard location
  WRAPPER_DIR="$HOME/.local/bin"
  mkdir -p "$WRAPPER_DIR"

  cat > "$WRAPPER_DIR/swynx" << EOF
#!/bin/bash
exec node "$INSTALL_DIR/bin/swynx" "\$@"
EOF
  chmod +x "$WRAPPER_DIR/swynx"

  # Auto-add to PATH if not already there
  if [[ ":$PATH:" != *":$WRAPPER_DIR:"* ]]; then
    SHELL_RC=""
    if [ -f "$HOME/.zshrc" ]; then
      SHELL_RC="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
      SHELL_RC="$HOME/.bashrc"
    fi

    if [ -n "$SHELL_RC" ]; then
      # Only add if not already in the file
      if ! grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$SHELL_RC" 2>/dev/null; then
        echo '' >> "$SHELL_RC"
        echo '# Swynx' >> "$SHELL_RC"
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
        echo -e "${GREEN}✓ Added to PATH in ${SHELL_RC}${NC}"
      fi
    fi

    # Also export for current session
    export PATH="$WRAPPER_DIR:$PATH"
  fi
}

print_success() {
  # Get local IP
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

  echo ""
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Swynx installed successfully!${NC}"
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo ""
  echo "  Quick start:"
  echo ""
  echo -e "    ${CYAN}swynx scan .${NC}              # Scan current directory"
  echo -e "    ${CYAN}swynx scan . --qualify${NC}   # With AI qualification"
  echo ""
  echo "  The AI engine installs automatically on first use."
  echo ""
  echo -e "  Dashboard: ${BLUE}http://${LOCAL_IP}:9000${NC}"
  echo -e "  Docs:      ${BLUE}https://github.com/swynx-io/swynx${NC}"
  echo ""
}

# Main
print_banner
check_node
install_swynx
setup_path
print_success
