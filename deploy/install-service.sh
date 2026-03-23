#!/bin/bash
# install-service.sh — Install Nexus as a system service
#
# Usage:
#   sudo bash deploy/install-service.sh          # auto-detect OS
#   sudo bash deploy/install-service.sh systemd   # force systemd
#   sudo bash deploy/install-service.sh launchd   # force launchd

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NEXUS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

detect_init() {
  if [[ "${1:-}" == "systemd" || "${1:-}" == "launchd" ]]; then
    echo "$1"
    return
  fi
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "launchd"
  elif command -v systemctl &>/dev/null; then
    echo "systemd"
  else
    echo "unknown"
  fi
}

install_systemd() {
  echo "Installing Nexus systemd service..."

  # Create nexus user if it doesn't exist
  if ! id -u nexus &>/dev/null; then
    useradd --system --home-dir /var/lib/nexus --create-home --shell /usr/sbin/nologin nexus
    echo "Created system user: nexus"
  fi

  # Create data directory
  mkdir -p /var/lib/nexus
  chown nexus:nexus /var/lib/nexus

  # Create env file directory
  mkdir -p /etc/nexus

  if [[ ! -f /etc/nexus/env ]]; then
    cat > /etc/nexus/env <<'ENVEOF'
# Nexus environment variables
# NEXUS_DATA_DIR=/var/lib/nexus
# NEXUS_MASTER_KEY=/var/lib/nexus/master.key
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
ENVEOF
    chmod 600 /etc/nexus/env
    echo "Created /etc/nexus/env — edit it to add your API keys"
  fi

  # Link or copy the Nexus installation
  if [[ ! -d /opt/nexus ]]; then
    ln -sfn "$NEXUS_DIR" /opt/nexus
    echo "Linked $NEXUS_DIR -> /opt/nexus"
  fi

  # Install the unit file
  cp "$SCRIPT_DIR/nexus.service" /etc/systemd/system/nexus.service
  systemctl daemon-reload
  systemctl enable nexus.service

  echo ""
  echo "Nexus service installed. Next steps:"
  echo "  1. Edit /etc/nexus/env with your API keys"
  echo "  2. sudo systemctl start nexus"
  echo "  3. sudo systemctl status nexus"
  echo "  4. journalctl -u nexus -f   (view logs)"
}

install_launchd() {
  echo "Installing Nexus launchd service..."

  PLIST_NAME="com.nexus.gateway"
  INSTALL_DIR="/usr/local/lib/nexus"
  DATA_DIR="/usr/local/var/lib/nexus"
  LOG_DIR="/usr/local/var/log/nexus"

  # Create directories
  mkdir -p "$DATA_DIR" "$LOG_DIR"

  # Link or copy installation
  if [[ ! -d "$INSTALL_DIR" ]]; then
    ln -sfn "$NEXUS_DIR" "$INSTALL_DIR"
    echo "Linked $NEXUS_DIR -> $INSTALL_DIR"
  fi

  # Install plist
  cp "$SCRIPT_DIR/$PLIST_NAME.plist" ~/Library/LaunchAgents/
  echo "Installed ~/Library/LaunchAgents/$PLIST_NAME.plist"

  echo ""
  echo "Nexus service installed. Next steps:"
  echo "  1. Set your API keys in your shell profile:"
  echo "     export ANTHROPIC_API_KEY=sk-ant-..."
  echo "  2. launchctl load ~/Library/LaunchAgents/$PLIST_NAME.plist"
  echo "  3. launchctl start $PLIST_NAME"
  echo "  4. tail -f $LOG_DIR/gateway.log   (view logs)"
}

INIT=$(detect_init "${1:-}")

case "$INIT" in
  systemd)
    install_systemd
    ;;
  launchd)
    install_launchd
    ;;
  *)
    echo "Error: Could not detect init system. Pass 'systemd' or 'launchd' as argument."
    exit 1
    ;;
esac
