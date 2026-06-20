#!/bin/bash
# SessionStart hook: install the Agent Reach tooling so the agent-reach skill
# is functional in Claude Code on the web sessions.
#
# The skill files (.claude/skills/agent-reach) live in the repo, but the
# upstream CLI + tools (agent-reach, yt-dlp, gh, mcporter, Exa search) are
# installed into the ephemeral container and must be re-provisioned per session.
# This script is idempotent: on a cached container it short-circuits quickly.
set -euo pipefail

# Only provision in remote (Claude Code on the web) containers — never touch a
# developer's local machine.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

VENV="$HOME/.agent-reach-venv"
BIN="$HOME/.local/bin"
mkdir -p "$BIN"

# Make the CLI tools discoverable for the rest of the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
export PATH="$BIN:$PATH"

# Install the agent-reach CLI into an isolated venv (system pip rejects some
# transitive deps under PEP 668 / Debian-patched setuptools).
if [ ! -x "$VENV/bin/agent-reach" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet "https://github.com/Panniantong/agent-reach/archive/main.zip"
fi

ln -sf "$VENV/bin/agent-reach" "$BIN/agent-reach"
ln -sf "$VENV/bin/yt-dlp" "$BIN/yt-dlp"

# Provision/refresh upstream infrastructure (gh CLI, mcporter, Exa search,
# yt-dlp JS runtime) and activate the zero-config channels. Never fail the
# session start if a single backend can't be reached.
agent-reach install --env=auto >/dev/null 2>&1 || true

exit 0
