---
section: guide
---
# How This Wiki Works

The 60-second manual. (You can hide this note: Physics & filters → Sections → tap **guide**.)

## Writing

- **Type `/` in the editor** for commands: link a note, create a linked note, set the section, headings, lists, code, and more.
- **Type `[[` to connect notes** — a picker appears; choose an existing note or create a new one on the spot. Links are what build the graph; a link to a note that doesn't exist yet shows as a faded *ghost* node.
- Notes get a color and a place from their section — set it with `/section`, or by hand:

```
---
section: research
---
```

- `Ctrl/Cmd+K` searches everything. **＋ New** creates a note.

## Sections of the brain

Each section is a color in the graph and a chip in **Physics & filters → Sections** — tap a chip to hide or show that part of the brain. Current sections: [[Research]], [[Projects]], [[Ideas]], [[Journal]], [[Reading List]]. To add a section, just create a note with a new `section:` value.

## Syncing

Edits save in your browser instantly and sync to the GitHub repo (⚙ Settings → token). Sync makes your notes permanent, shared across devices, and visible to Claude.

## Growing it with AI

In a Claude Code session on this repo, say: *"Research X and add it to my wiki."* Claude gathers sources with agent-reach and files linked notes into [[Research]]. Your graph grows on the next sync.
