#!/bin/bash
# SessionStart hook: install the Agent Reach tooling so the agent-reach skill
# is functional in Claude Code on the web sessions.
#
# The skill files (.claude/skills/agent-reach) live in the repo, but the
# upstream CLI + tools (agent-reach, yt-dlp, gh, mcporter, bili-cli, ffmpeg,
# Exa search) are installed into the ephemeral container and must be
# re-provisioned per session. This script is idempotent: on a cached container
# it short-circuits quickly. Full output is logged to /tmp/agent-reach-hook.log.
set -uo pipefail

# Only provision in remote (Claude Code on the web) containers — never touch a
# developer's local machine.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

LOG=/tmp/agent-reach-hook.log
exec 3>&1
exec >>"$LOG" 2>&1
echo "=== session-start $(date -u +%FT%TZ) ==="

VENV="$HOME/.agent-reach-venv"
BIN="$HOME/.local/bin"
mkdir -p "$BIN"

# Make the CLI tools discoverable for the rest of the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
export PATH="$BIN:$PATH"

# Install the agent-reach CLI into an isolated venv (system pip rejects some
# transitive deps under PEP 668 / Debian-patched setuptools). Install from a
# git clone, not the GitHub archive URL: the web container's egress proxy
# allows git-over-HTTPS but returns 403 for codeload archive downloads, and
# the package is not on PyPI.
if [ ! -x "$VENV/bin/agent-reach" ]; then
  SRC=/tmp/agent-reach-src
  rm -rf "$SRC"
  git clone --quiet --depth 1 https://github.com/Panniantong/agent-reach.git "$SRC" \
    && python3 -m venv "$VENV" \
    && "$VENV/bin/pip" install --quiet --upgrade pip \
    && "$VENV/bin/pip" install --quiet "$SRC" \
    || echo "WARN: agent-reach venv install failed"
fi

# Companion tools in the same venv (each optional — failures don't block):
#  - bilibili-cli: full Bilibili search/detail with no login
#  - curl_cffi: yt-dlp browser impersonation (resilience on server IPs)
#  - twitter-cli: pre-installed so Twitter unlocks the moment cookies are configured
for pkg in bilibili-cli curl_cffi twitter-cli; do
  "$VENV/bin/pip" install --quiet "$pkg" || echo "WARN: $pkg install failed"
done

for tool in agent-reach yt-dlp bili twitter; do
  [ -x "$VENV/bin/$tool" ] && ln -sf "$VENV/bin/$tool" "$BIN/$tool"
done

# ffmpeg: required for yt-dlp best-format merging and the Xiaoyuzhou
# transcription pipeline (audio transcode/slice).
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get install -y ffmpeg || echo "WARN: ffmpeg install failed"
fi

# Provision/refresh upstream infrastructure (gh CLI, mcporter, Exa search,
# yt-dlp JS runtime) and activate the zero-config channels. Never fail the
# session start if a single backend can't be reached.
agent-reach install --env=auto || echo "WARN: agent-reach install failed"

# The installer registers Exa in a project-local config/mcporter.json (relative
# to cwd). Mirror it to mcporter's system config so Exa search works regardless
# of the agent's working directory.
mkdir -p "$HOME/.mcporter"
if [ ! -f "$HOME/.mcporter/mcporter.json" ]; then
  cat > "$HOME/.mcporter/mcporter.json" <<'JSON'
{
  "mcpServers": {
    "exa": {
      "baseUrl": "https://mcp.exa.ai/mcp"
    }
  }
}
JSON
fi

echo "=== session-start done $(date -u +%FT%TZ) ==="
echo "agent-reach hook: provisioning complete (log: $LOG)" >&3
exit 0
