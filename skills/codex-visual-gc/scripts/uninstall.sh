#!/usr/bin/env bash
# uninstall.sh - Safely uninstall codex-visual-gc from native Codex environment

set -euo pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
TURN_HOOK="$CODEX_HOME/turn-ended-hook.sh"

echo "=== Uninstalling Codex Visual GC ==="

if [ -f "$TURN_HOOK" ]; then
  # Remove gc_engine line from hook
  sed -i '' '/gc_engine\.py/d' "$TURN_HOOK" 2>/dev/null || sed -i '/gc_engine\.py/d' "$TURN_HOOK" 2>/dev/null || true
  sed -i '' '/# Codex Visual GC Hook/d' "$TURN_HOOK" 2>/dev/null || sed -i '/# Codex Visual GC Hook/d' "$TURN_HOOK" 2>/dev/null || true
  echo "-> Detached gc_engine.py from $TURN_HOOK"
fi

echo "-> Note: $CODEX_HOME/visual_gc.json was left intact in case you want to keep your settings."
echo "=== Uninstallation Complete ==="
