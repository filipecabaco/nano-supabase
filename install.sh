#!/usr/bin/env sh
set -e

REPO="filipecabaco/nano-supabase"
INSTALL_DIR="${NANO_SUPABASE_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="nano-supabase"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64) TARGET="darwin-arm64" ;;
      x86_64) TARGET="darwin-x64" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64) TARGET="linux-x64" ;;
      aarch64) TARGET="linux-arm64" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

LATEST_TAG="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"\(.*\)".*/\1/')"
BINARY_FILE="${BINARY_NAME}-${TARGET}"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/${BINARY_FILE}"

echo "Downloading nano-supabase ${LATEST_TAG} for ${TARGET}..."
curl -fsSL "$DOWNLOAD_URL" -o "/tmp/${BINARY_FILE}"
chmod +x "/tmp/${BINARY_FILE}"

echo "Installing to ${INSTALL_DIR}/${BINARY_NAME}..."
mv "/tmp/${BINARY_FILE}" "${INSTALL_DIR}/${BINARY_NAME}"

echo "nano-supabase installed successfully!"
echo "Run: nano-supabase --help"
