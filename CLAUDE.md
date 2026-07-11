# Closet

This repo is a **second brain**: a wiki of markdown notes in `/notes`
visualized by a client-side graph app in `/app` (deployed to GitHub Pages),
plus the **agent-reach** skill (`.claude/skills/agent-reach/`) — an
internet-access router for Claude Code covering 15 platforms — and a
SessionStart hook that provisions its tooling in Claude Code on the web.

## The wiki (`/vault` + `/app`) — END-TO-END ENCRYPTED

Notes are **encrypted at rest**: each note is an AES-GCM blob in `/vault`
with a hashed filename (titles hidden), keyed by a vault key that only the
user's password unwraps (`settings/vault.json` holds the wrapped key — safe
to be public). The app at `https://danielitouh.github.io/Closet/` ships **no
note content**; notes appear only after unlocking on a device. Legacy
plaintext `/notes` is migrated+deleted automatically by the app on the
user's first unlocked sync — never recreate it.

**Sessions cannot read or write notes without the user's vault password.**
When a task needs the wiki, ask the user to provide the password for this
session, export it as `VAULT_PASSWORD` (never write it to a file, never echo
it), and use the CLI:

```bash
VAULT_PASSWORD=... node scripts/vault-cli.mjs list            # all note titles
VAULT_PASSWORD=... node scripts/vault-cli.mjs read --title "X" # one note's markdown
VAULT_PASSWORD=... node scripts/vault-cli.mjs add  --title "X" --file /tmp/x.md
```

`add` writes the encrypted blob into `/vault`; commit and push as usual.
Never commit plaintext notes anywhere in the repo.

### Sections of the brain

The wiki is organized into **sections** — set with frontmatter
`section: <name>` (falls back to the first tag). A note's section drives its
color and its filter chip in the app. Current sections: `home`, `guide`,
`research`, `projects`, `ideas`, `journal`, `reading`; each has a hub note
(`Research.md`, `Projects.md`, …). The user's brain starts deliberately
minimal — do not add encyclopedia/demo notes; only file content the user
asked for.

### Ingestion workflow ("research X and add it to my wiki")

When asked to research a topic and save it: gather with agent-reach, then
file notes **through the vault CLI** (which needs the user's password — ask
for it once per session, use it only as the `VAULT_PASSWORD` env var):

1. Gather with agent-reach (Exa search, Jina reading, YouTube subs, etc.).
2. Discover existing titles with `vault-cli list` (and `read` for hubs).
3. Write **one note per idea** (not per source) to a temp file in `/tmp`,
   then `vault-cli add --title "<Title>" --file /tmp/<f>.md`:
   - Start with frontmatter: `---\nsection: research\ntags: [topic]\n---`
     (use another section if the user says so).
   - Include a `Source:` line with the URL for anything drawn from the web.
   - Add at least two `[[wikilinks]]` to related notes so nothing enters the
     graph as an orphan.
   - Update the section hub (read it, append the link, `add` it back).
4. Keep titles short and noun-like — they are node labels and link text.
5. Commit the new `/vault` blobs and push. Never delete or rewrite existing
   notes unless asked; append and link instead. Delete the `/tmp` plaintext
   when done.

### Working on the app

`cd app && npm install` once per container, then `npm test` (parser unit
tests), `npm run dev`, `npm run build`. The deploy workflow
(`.github/workflows/deploy-pages.yml`) runs tests + build on every push to
main. The app is 100% client-side; notes sync from the browser via the
GitHub Contents API with a user-provided fine-grained token.

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

- **Twitter/X** — `twitter` CLI is pre-installed and the user has set
  `TWITTER_AUTH_TOKEN` + `TWITTER_CT0` in the environment, **but the CLI
  cannot work in Claude Code web containers**: the egress proxy resets
  browser-impersonated TLS handshakes (curl error 35), which curl_cffi
  impersonation — and therefore twitter-cli — depends on. Verified 2026-07;
  plain TLS to x.com passes, impersonated TLS is reset regardless of CA
  bundle. Do not retry or debug this in web sessions. The CLI works from a
  local machine with the same env vars. **Twitter research fallback that
  works here**: read public tweets/threads with Jina
  (`curl -s "https://r.jina.ai/https://x.com/user/status/ID"`), and discover
  tweet content via Exa (threadreaderapp.com unrolls, thread roundups).
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
