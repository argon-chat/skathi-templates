# Git

A git client written in Vue for Skathi. It stages whole files, hunks or single lines, writes the commit,
and draws every branch of the repository on one timeline.

```bash
bun install
bun run dev            # opens the folder picker
bun run dev -- ../repo # opens a repository straight away
bun run build
```

## What it does

- **Changes**: unstaged and staged lists with status badges. Stage, unstage or discard a file (discarding
  asks first). Keyboard: arrows, Home/End, Space or Enter to stage, Delete to discard.
- **Diff**: one `<sk-editor>` per hunk, with old and new line numbers and +/− in its gutter, rounded word
  highlights, light syntax colouring and real tabs. Long lines scroll sideways, or wrap with the toggle in
  the header. The unchanged lines between hunks are counted, a change map runs along the right edge
  (click to jump), and each hunk's header stays on screen while its hunk scrolls. Stage, unstage or
  discard a hunk, or click and drag the gutter to pick lines (Shift+click extends). Untracked files show
  as all-added; binary files and diffs over 2 MB say so instead.
- **Commit**: a message editor that marks a summary past 50 characters and body lines past 72, amend,
  co-authors from the history, and git's own stderr when a hook refuses the commit.
- **History**: a full-width table of every branch, remote and tag, with coloured lanes, merge nodes,
  avatars, resizable columns and the selected commit's files and diff below. 100k commits stay
  responsive: the log is read as you scroll and the graph is laid out a page at a time.
- **Branches**: a switcher with each branch in its lane's colour, its last commit and how far it is
  ahead of or behind its upstream; type a new name to create one. Fetch, pull and push show git's
  output; with no upstream, push sets one on `origin`.

Everything refreshes when the window gets focus and after each operation, and every git call can be
cancelled.

## Shortcuts

| Keys                                       | Action                            |
| ------------------------------------------ | --------------------------------- |
| Ctrl+O                                     | Open a repository                 |
| Ctrl+1 / Ctrl+2                            | Changes / History                 |
| Ctrl+B                                     | Switch branch                     |
| Ctrl+Enter                                 | Commit                            |
| Ctrl+Shift+A                               | Stage all                         |
| Ctrl+Shift+F / Ctrl+Shift+L / Ctrl+Shift+P | Fetch / Pull / Push               |
| F5 or Ctrl+R                               | Refresh                           |
| Esc                                        | Clear picked lines, close a panel |

## How it talks to git

The app runs the `git` on your PATH through `skathi:process`, always with an argument array, and parses
the porcelain formats (`status --porcelain=v2 -z`, `log` with field separators). Every call sets
`GIT_TERMINAL_PROMPT=0` so git never waits for a password, `GIT_OPTIONAL_LOCKS=0` so a background refresh
does not take the index lock, and `LC_ALL=C` so the output is the one the parsers expect. There is no
credential UI: use a credential helper or SSH agent.

The `"permissions.process"` entry in `sk.config.json` finds `git` on PATH and lets it take any arguments,
which `sk check` warns about as SK6004; `"check.allow"` accepts that for `src/git/run.ts`. That is
deliberate. A git client has to use the git the user installed, and the arguments it passes (paths,
branch names, commit hashes) are not a fixed list.

## Effects

`shaders/` holds the app's own effects, each with quality tiers that step down under load and with
reduced motion:

- `field`: the drifting lights behind the welcome screen and the empty states.
- `lanepulse`: the light that runs down the current branch's lane in the history.
- `charge`: the Commit button's glow while something is staged, and the sweep when a commit lands.
- `progress`: the bar under the title bar while git talks to a remote.

The window uses the system material (Mica on Windows): the title bar and sidebar are translucent, the
panes nearly opaque, and everything turns solid where the system draws no material.
