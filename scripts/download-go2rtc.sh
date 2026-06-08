#!/usr/bin/env bash
# Download the go2rtc binary into ./bin for desktop / bare-metal use.
# Docker deployments do NOT need this (they use the alexxit/go2rtc image).
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p bin

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Linux)
    case "$arch" in
      x86_64) asset="go2rtc_linux_amd64" ;;
      aarch64|arm64) asset="go2rtc_linux_arm64" ;;
      armv7l) asset="go2rtc_linux_arm" ;;
      *) echo "Unsupported Linux arch: $arch" >&2; exit 1 ;;
    esac
    out="bin/go2rtc"
    url="https://github.com/AlexxIT/go2rtc/releases/latest/download/${asset}"
    echo "Downloading ${asset}…"
    curl -fsSL "$url" -o "$out"
    chmod +x "$out"
    ;;
  Darwin)
    case "$arch" in
      arm64) asset="go2rtc_mac_arm64.zip" ;;
      x86_64) asset="go2rtc_mac_amd64.zip" ;;
      *) echo "Unsupported macOS arch: $arch" >&2; exit 1 ;;
    esac
    url="https://github.com/AlexxIT/go2rtc/releases/latest/download/${asset}"
    echo "Downloading ${asset}…"
    curl -fsSL "$url" -o /tmp/go2rtc.zip
    unzip -o /tmp/go2rtc.zip -d bin >/dev/null
    chmod +x bin/go2rtc
    ;;
  *)
    echo "Unsupported OS: $os. Download go2rtc manually into ./bin" >&2
    exit 1
    ;;
esac

echo "go2rtc installed:"
./bin/go2rtc -version 2>&1 | head -1
