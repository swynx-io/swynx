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

install_ai_engine() {
  echo -e "${BLUE}Installing Swynx Engine (AI)...${NC}"

  # Check if Ollama is installed
  if ! command -v ollama &> /dev/null; then
    echo "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
    echo -e "${GREEN}✓ Ollama installed${NC}"
  else
    echo -e "${GREEN}✓ Ollama already installed${NC}"
  fi

  # Start Ollama service if not running
  if ! pgrep -x "ollama" > /dev/null 2>&1; then
    echo "Starting Ollama service..."
    ollama serve > /dev/null 2>&1 &
    sleep 3
  fi

  # Pull the AI model
  echo "Pulling AI model (${AI_MODEL})..."
  echo "This may take a few minutes on first install (~1.8GB)..."
  ollama pull "$AI_MODEL"

  # Verify model is available
  if ollama list | grep -q "qwen2.5-coder"; then
    echo -e "${GREEN}✓ Swynx Engine ready${NC}"
  else
    echo -e "${YELLOW}Warning: Model pull may still be in progress${NC}"
  fi
}

print_success() {
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

  echo ""
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Swynx installed successfully!${NC}"
  echo -e "${GREEN}════════════════════════════════════════════${NC}"
  echo ""
  echo "  Run your first scan:"
  echo ""
  echo -e "    ${CYAN}swynx scan .${NC}              # Basic scan"
  echo -e "    ${CYAN}swynx scan . --qualify${NC}   # With AI analysis"
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
install_ai_engine
print_success
