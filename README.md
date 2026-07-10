# Closet 🧠

A personal **second brain**: markdown notes connected by `[[wikilinks]]`,
visualized as a live force-directed graph you can zoom, drag, and click —
plus the **agent-reach** skill so Claude Code can research the internet and
file what it finds directly into the wiki.

## The wiki

- **Live at:** `https://danielitouh.github.io/Closet/` (after Pages is enabled, see below)
- **Notes live in [`/notes`](notes/)** as plain markdown — versioned, portable, git-friendly.
- **The app lives in [`/app`](app/)** — 100% client-side (Vite + React + force-graph),
  no server anywhere. Your edits save instantly in the browser and sync back
  to this repo through the GitHub API.

### Features

- Force-directed **graph view**: nodes sized by connections, colored by tag,
  labels fade in as you zoom. Hover highlights a note's neighborhood; click
  opens the note. Smooth on 1,000+ notes (canvas rendering).
- **Editor** with live markdown preview, `[[wikilink]]` support with aliases,
  ghost notes (link to a note that doesn't exist → faded node → click to create).
- **Backlinks** panel, **full-text search** (Ctrl/Cmd+K), tag filters,
  physics sliders, per-note **local graph** focus mode.
- **GitHub sync**: paste a fine-grained token once per browser; notes push/pull
  to `/notes` automatically. Works fully offline without a token too
  (browser storage + zip export/import).

### One-time setup

1. **Enable Pages:** repo **Settings → Pages → Source: GitHub Actions**.
   The next push to `main` deploys the app.
2. **Create a sync token** (to save notes from the app back to this repo):
   GitHub **Settings → Developer settings → Fine-grained tokens → Generate new token**,
   Repository access: *Only select repositories* → this repo,
   Permissions: **Contents → Read and write**. Copy the `github_pat_…` value.
3. Open the app → ⚙ Settings → paste the token → Save → Sync now.
   The token stays in your browser's localStorage; it is never committed.
4. Open Settings → Two-step verification, add the manual key to an
   authenticator app, choose an unlock password, and enter the current
   six-digit code. After that, this browser must pass both steps before notes
   or sync settings load.

### Local development

```bash
cd app
npm install
npm run dev      # dev server
npm test         # parser unit tests
npm run build    # production build (served under /Closet/)
```

## The agent-reach skill

`.claude/skills/agent-reach/` routes Claude Code to 15 internet platforms
(web pages, semantic search, YouTube, Bilibili, V2EX, RSS zero-config;
Twitter/Reddit/XHS/etc. with cookies). A SessionStart hook provisions all
tooling automatically in Claude Code web sessions. Details in
[CLAUDE.md](CLAUDE.md).

## The loop 🔁

The two halves compose. In a Claude Code session on this repo, say:

> *Research ambient computing across the web and add what matters to my wiki.*

Claude uses agent-reach to search and read sources, distills them into
atomic notes with wikilinks in `/notes`, and pushes. The Pages deploy
rebuilds, and the new notes snap into your graph.
