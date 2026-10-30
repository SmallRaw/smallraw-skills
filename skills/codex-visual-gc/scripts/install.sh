#!/usr/bin/env bash
# install.sh - Install and mount codex-visual-gc into native Codex environment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CONFIG_TOML="$CODEX_HOME/config.toml"
TURN_HOOK="$CODEX_HOME/turn-ended-hook.sh"
USER_CONFIG="$CODEX_HOME/visual_gc.json"

echo "=== Installing Codex Visual GC Plugin ==="
mkdir -p "$CODEX_HOME"

# 1. Initialize user configuration if not present
if [ ! -f "$USER_CONFIG" ]; then
  echo "-> Initializing user config: $USER_CONFIG"
  cp "$PLUGIN_ROOT/config.json" "$USER_CONFIG"
else
  echo "-> User config already exists: $USER_CONFIG (keeping existing settings)"
fi

# 2. Wire hook script
echo "-> Configuring turn-ended hook in: $TURN_HOOK"
if [ ! -f "$TURN_HOOK" ]; then
  cat <<'EOF' > "$TURN_HOOK"
#!/bin/sh
export HOME="${HOME:-/Users/smallraw}"

# Original SkyComputerUse client if installed
SKY_CLIENT="/Users/smallraw/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient"
if [ -x "$SKY_CLIENT" ]; then
  "$SKY_CLIENT" "$@" >/dev/null 2>&1 &
fi
EOF
  chmod +x "$TURN_HOOK"
fi

# Ensure hook calls our gc_engine.py
GC_EXEC="/usr/bin/python3 \"$PLUGIN_ROOT/scripts/gc_engine.py\" >/dev/null 2>&1 &"
if ! grep -q "gc_engine.py" "$TURN_HOOK" 2>/dev/null; then
  cat <<EOF >> "$TURN_HOOK"

# Codex Visual GC Hook
$GC_EXEC
EOF
  echo "-> Attached gc_engine.py to $TURN_HOOK"
else
  echo "-> gc_engine.py is already attached to $TURN_HOOK"
fi

# 3. Ensure ~/.codex/config.toml has notify wired
if [ -f "$CONFIG_TOML" ]; then
  if ! grep -q "turn-ended-hook.sh" "$CONFIG_TOML"; then
    echo "-> Wiring notify in $CONFIG_TOML"
    # Append notify if not set, or note to user
    echo 'notify = ["/bin/sh", "/Users/smallraw/.codex/turn-ended-hook.sh", "turn-ended"]' >> "$CONFIG_TOML"
  else
    echo "-> notify in $CONFIG_TOML already invokes turn-ended-hook.sh"
  fi
fi

# 4. Optional: run an initial sweep
echo "-> Running initial sweep on existing sessions..."
python3 "$PLUGIN_ROOT/scripts/gc_engine.py" --sweep-all

echo ""
echo "=== Codex Visual GC Installed Successfully! ==="
echo "Configuration file: $USER_CONFIG"
echo "You can adjust threshold_mb, prune_ratio, and other parameters in that file anytime."
