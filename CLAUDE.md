# Closet

This repo hosts the **agent-reach** skill (`.claude/skills/agent-reach/`) — an
internet-access router for Claude Code covering 15 platforms — plus a
SessionStart hook that provisions its tooling in Claude Code on the web.

## How the environment is provisioned

`.claude/hooks/session-start.sh` runs at session start (remote containers
only) and installs: the `agent-reach` CLI in `~/.agent-reach-venv`, `yt-dlp`
(+ `curl_cffi`), `bili`, `twitter`, `gh`, `mcporter` (Exa search), and
`ffmpeg`. Tools are symlinked into `~/.local/bin`. The hook is idempotent and
logs to `/tmp/agent-reach-hook.log` — check that log first if a tool is
missing.

Run `agent-reach doctor --json` to see live channel status and the active
backend per platform.

## Channel status

Working with zero configuration (verified):

| Channel | Command |
|---|---|
| Any web page | `curl -s "https://r.jina.ai/URL"` |
| Semantic web search | `mcporter call 'exa.web_search_exa(query: "...", numResults: 5)'` |
| YouTube subs/metadata | `yt-dlp --write-auto-sub --sub-lang en --skip-download -o "/tmp/%(id)s" URL` |
| Bilibili | `bili search "query" --type video -n 5` |
| V2EX | `curl -s "https://www.v2ex.com/api/topics/hot.json" -H "User-Agent: agent-reach/1.0"` |
| RSS/Atom | `python3 -c "import feedparser; ..."` (use the venv python) |

Locked until the user provides credentials (do not attempt workarounds):

- **Twitter/X** — `twitter` CLI is pre-installed; needs cookies via
  `agent-reach configure twitter-cookies "..."` (or `TWITTER_AUTH_TOKEN` +
  `TWITTER_CT0` env vars). No zero-config path on a headless server.
- **Reddit, Xiaohongshu, Xueqiu, LinkedIn, Facebook, Instagram** — need login
  cookies / MCP setup; see `.claude/skills/agent-reach/references/`.
- **Xiaoyuzhou transcription** — needs a free Groq key:
  `agent-reach configure groq-key gsk_...` (ffmpeg already provisioned).

## GitHub access in web sessions

`gh` is installed but **unauthenticated** (no token exists in remote
containers, so `gh auth login` is not possible here). For GitHub reads/writes
in Claude Code on the web, use the GitHub MCP tools (`mcp__github__*`)
instead of `gh`. On a local machine, `gh auth login` unlocks the gh path.

## Conventions

- Temporary output goes to `/tmp/` (or the session scratchpad), never the repo.
- `config/` at the repo root is a runtime artifact of `agent-reach install`
  (mcporter's project-local Exa config) and is gitignored; the canonical copy
  lives at `~/.mcporter/mcporter.json`.
