#!/bin/bash
# Package Swynx for air-gapped client distribution
set -e

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
RELEASE_NAME="swynx-v${VERSION}"

echo "Packaging ${RELEASE_NAME}..."

# Check model exists
if [[ ! -f "models/swynx-deadcode.gguf" ]]; then
    echo "ERROR: models/swynx-deadcode.gguf not found"
    echo "Run ./scripts/finetune-mac.sh first"
    exit 1
fi

# Create release directory
rm -rf "dist/${RELEASE_NAME}"
mkdir -p "dist/${RELEASE_NAME}"

# Copy files
cp -r bin "dist/${RELEASE_NAME}/"
cp -r src "dist/${RELEASE_NAME}/"
cp -r models "dist/${RELEASE_NAME}/"
cp package.json "dist/${RELEASE_NAME}/"
cp README.md "dist/${RELEASE_NAME}/" 2>/dev/null || true

# Create install script for clients
cat > "dist/${RELEASE_NAME}/install.sh" << 'INSTALL'
#!/bin/bash
set -e
echo "Installing Swynx..."

# Install to /opt/swynx
sudo mkdir -p /opt/swynx
sudo cp -r . /opt/swynx/
sudo ln -sf /opt/swynx/bin/swynx /usr/local/bin/swynx

# Install Ollama if needed
if ! command -v ollama &> /dev/null; then
    echo "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

# Load the bundled model
echo "Loading AI model..."
cd /opt/swynx/models
ollama create swynx-deadcode -f Modelfile.gguf

echo "Done! Run: swynx dashboard"
INSTALL
chmod +x "dist/${RELEASE_NAME}/install.sh"

# Create tarball
cd dist
tar -czvf "${RELEASE_NAME}.tar.gz" "${RELEASE_NAME}"

# Show result
SIZE=$(du -h "${RELEASE_NAME}.tar.gz" | cut -f1)
echo "
Created: dist/${RELEASE_NAME}.tar.gz (${SIZE})

Client install:
  tar -xzvf ${RELEASE_NAME}.tar.gz
  cd ${RELEASE_NAME}
  ./install.sh
"
