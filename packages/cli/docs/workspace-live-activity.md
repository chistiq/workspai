# Workspai Live Activity

`workspai live` renders the execution graph of Workspai commands running in
other terminals for the same project or workspace.

```bash
# Terminal A
workspai live

# Terminal B
workspai workspace intelligence run

# Terminal C
workspai doctor workspace
```

The monitor is observational. Closing it does not cancel commands, and a
journal or renderer failure cannot change command success.

## Commands

```bash
workspai live [target]
workspai live --global
workspai live --global --max-scopes 20 --max-runs 20
workspai live --run <run-id>
workspai live --once
workspai live --once --json
workspai live --once --json --projection board
workspai live --refresh-ms 500 --max-runs 10
workspai live --no-motion --no-color
workspai live --ascii
workspai live --accessible
workspai live --classic
workspai live --capture workspai-live.svg
workspai live --capture launch.svg --capture-preset linkedin --capture-theme obsidian
workspai live --capture internal.svg --no-capture-redact
workspai live --replay <run-id> --replay-speed 4
```

`target` defaults to the current directory. `--once` is suitable for scripts,
diagnostics and tests. Without a TTY, `--json` emits a new snapshot only when
projected activity changes. `--global` discovers bounded machine-local activity
channels and produces one fleet view across projects and workspaces; it cannot
be combined with `target`.

JSON defaults to the backward-compatible monitor projection. Use
`--projection board` for the public `workspace-activity-board.v1` projection
consumed by IDE, browser, dashboard and capture adapters. It contains bounded
runs, nodes, edges, selection, counters and diagnostics; consumers must not
infer verification success from activity state.

`--capture` writes an atomic, deterministic SVG from the same Activity Board
Model used by the terminal and exits. Captures are redacted by default: local
scope, project, run and command-argument details are replaced while semantic
stage and outcome data remain. Presets are `github` (1280×720), `linkedin`
(1200×627), `x`/`wide` (1600×900) and `square` (1080×1080); themes are
`obsidian`, `light` and `mono`. Use `--no-capture-redact` only for an explicitly
internal artifact.

`--replay <run-id>` reconstructs the selected run from immutable event prefixes
instead of inventing UI state. Replay defaults to 4× speed, accepts
`--replay-speed 0.25..64`, and is scoped to the target project or workspace.

## Flow Board

The default TTY renderer is a bounded full-screen Flow Board, not an appended
log. Each command publishes a versioned execution blueprint containing stable
block and edge IDs. The board then projects real transitions onto that graph:

- a running block uses an active cyan border;
- successful, warning/blocked and failed blocks become green, yellow and red;
- a running handoff animates on the edge entering the next block;
- full-board connections terminate in weight-matched ports on the card frame;
  font-dependent triangle arrowheads are not mixed with box-drawing lines, and
  direction is conveyed by an aligned moving wire segment plus the serpentine
  flow layout;
- cards reserve their frame for topology and their content row for a stable
  `QUEUE/RUN/DONE/WARN/BLOCK/FAIL` status rail, attempt and progress metadata;
- a block started again after a terminal outcome is a new durable attempt; its
  card shows `↻2`, `↻3`, and so on, retains earlier attempt outcomes and
  reactivates the incoming flow wire;
- independent runs may have multiple active blocks at the same time;
- phase rails are emitted by command blueprints, so grouping reflects command
  architecture rather than a repository-specific UI assumption;
- terminals at least 132 columns wide receive a factual Inspector for the
  selected active/problem block: state, phase, attempt, progress, elapsed time,
  touches, artifacts and warnings; `i` or `Tab` toggles it;
- the selected run receives the full flow graph; other running commands are
  reduced to one minimal `ALSO ACTIVE` dock in local mode; global mode uses a
  Fleet Cockpit with location, command, active block, status and elapsed time
  before the selected run graph;
- journals left running by a process that no longer exists are projected as
  orphaned/cancelled and never inflate the active counter or active-run dock;
- narrow or short terminals automatically collapse to chips without losing
  status or ordering.

The renderer updates changed terminal rows only and uses the alternate screen,
so monitoring does not produce an unbounded scrollback stream. Resize triggers
a safe full redraw. Interactive controls are:

| Key                  | Effect                                        |
| -------------------- | --------------------------------------------- |
| `↑` / `↓`, `j` / `k` | Select a run                                  |
| `Enter`              | Focus/unfocus the selected run                |
| `i`, `Tab`           | Toggle the adaptive Inspector                 |
| `f`                  | Toggle active runs only                       |
| `q`, `Ctrl+C`        | Close the monitor without cancelling commands |

Replay controls are `Space` to play/pause, `←`/`→` (or `,`/`.`) to step one
durable event backward/forward, and `q` to close. Reaching the last event pauses
the replay instead of exiting, which keeps the terminal ready for inspection.

`NO_COLOR`, `TERM=dumb`, `WORKSPAI_LIVE_ASCII=1` and
`WORKSPAI_LIVE_REDUCED_MOTION=1` are honored. `--accessible` uses a stable,
non-animated linear projection with no terminal control sequences for screen
readers and captured output. `--classic` preserves the compatibility renderer.

The implementation intentionally keeps this pipeline renderer-independent:

```text
workspace-activity-event.v1
  -> deterministic monitor snapshot
  -> workspace-activity-board.v1 (runs, nodes, edges, selection, counters)
  -> terminal + deterministic SVG adapters today / web and IDE adapters later
```

No TUI framework is part of the Activity runtime. This prevents React/Yoga or
terminal-widget lifecycle state from entering the future package boundary and
keeps browser/IDE renderers able to consume the same Board Model.

## Project and workspace behavior

The command works before adoption and does not create metadata in an ordinary
project. Activity journals are stored in machine-local state:

- Linux: `$XDG_STATE_HOME/workspai/activity`, or `~/.local/state/workspai/activity`;
- macOS: `~/Library/Application Support/Workspai/activity`;
- Windows: `%LOCALAPPDATA%\Workspai\activity`.

`WORKSPAI_ACTIVITY_STATE_DIR` overrides this location. Set
`WORKSPAI_ACTIVITY_DISABLE=1` to disable journaling.

An adopted or linked project keeps its stable physical project channel and
mirrors the same event/run identities into its workspace channel. This allows a
monitor opened before `adopt` to keep following the run while a monitor at the
workspace root receives subsequent linked-project activity.

`workspai live --global` scans the bounded local channel registry, deduplicates
mirrored records by event identity, then groups runs by semantic scope. Every
run also carries a machine-local origin identity, so two projects in one
workspace remain distinguishable while sharing one workspace lane, and projects
from different workspaces retain separate scope labels. The selected run owns
the full graph; concurrent activity from other origins stays visible in the
Fleet Cockpit without merging independent timelines.

## Event contract

Every NDJSON line conforms to:

```text
contracts/workspace-activity-event.v1.json
contracts/workspace-activity-monitor-snapshot.v1.json
contracts/workspace-activity-monitor-fleet.v1.json
contracts/workspace-activity-board.v1.json
```

The stream contains run, block, attempt, origin, declared-edge, operation,
touch, artifact and warning data. Blueprint edges are explicit `sequence`, `parallel`, `gate` or
`handoff` relations; older journals without declared edges receive a
deterministic sequential projection for compatibility.
Stable semantic block IDs describe architecture stages rather than source line
numbers or function names.

Activity is not evidence or authorization:

- progress does not prove a result;
- an exit code does not verify an engineering outcome;
- a planned touch is not an observed effect;
- the Activity journal is not the Evidence or Decision Ledger.

Canonical domain artifacts and receipts remain owned by Model, Graph, Doctor,
Security, Decisions and their existing contracts.

## Privacy and retention

- sensitive command options and metadata keys are redacted before persistence;
- absolute paths are converted to project-relative locators when possible;
- external targets expose only an `<external>/<basename>` locator;
- environment variables, file contents and raw subprocess output are not stored;
- the runtime retains at most 200 journals and 14 days per channel by default,
  even when no monitor is open;
- replay applies bounded per-journal read windows, a 20,000-event scoped ceiling
  and a 50,000-event global ceiling so corrupt or oversized history cannot grow
  monitor memory without limit;
- state directories and journals are created with user-only permissions where
  the platform supports POSIX modes.

## Current limitations

- live transport uses bounded journal polling rather than an IPC broker;
- the local web/SSE renderer is planned but not implemented;
- arbitrary shell commands require a future explicit wrapper or SDK for
  semantic block attribution;
- full filesystem reconciliation and syscall-level deep tracing are not part of
  the default profile.

The future package boundary and extraction gates are documented in
`Docs/npm/Packages/ACTIVITY_PLANE_EXTRACTION_PLAN.md`.
