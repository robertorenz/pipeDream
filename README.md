# Pipe Dream

A browser remake of the 1989 puzzle classic *Pipe Dream* (a.k.a. *Pipe Mania*),
with all 36 levels and two switchable views: the classic **flat** top-down look
and a **2.5D** isometric rendering with shaded tubes and extruded walls.

No build step, no dependencies — open `index.html` in a browser and play.

## Playing

The flooz leaves the amber **start piece** when the countdown runs out. Lay pipe
ahead of it using the pieces from the queue (the next piece is at the bottom).
Every level sets a **distance** — the number of pipe sections the flooz has to
pass through. Reach it and the level is cleared; spill before then and it's
game over.

| Input | Action |
|---|---|
| Click / tap a cell | Lay the next piece there |
| `← ↑ → ↓` + `Enter` | Move the cursor and place with the keyboard |
| `Space` / **Flow!** | Skip the countdown and run the flooz fast (stays fast for the level) |
| `P` / `Esc` | Pause |
| `V` | Toggle Flat / 2.5D |
| `M` | Toggle sound |
| `H` | How to play |

You can drop a piece on top of one already on the board as long as the flooz
hasn't reached it. It costs 50 points and a moment's delay, exactly like the
original.

### Scoring

| Event | Points |
|---|---|
| Each section the flooz fills | +50 |
| Both channels of a cross piece filled | +500 |
| Flooz reaches the end piece | +1000 |
| Replacing a piece | −50 |
| Each unused piece removed at the end of a level | −100 |

The score never drops below zero. Your best score is kept in `localStorage`.

### Special pieces

- **Walls** — nothing can be built on them.
- **Reservoirs** — fixed straights with a tank; they take three times longer to
  fill, which buys you time.
- **One-way pipes** — fixed straights with red arrows. Enter against the arrow
  and the flooz spills.
- **End piece** — the flooz has to enter through its opening. Reaching it ends
  the level with a bonus, but you still need to have covered the distance.
- **Pre-placed pipes** — ordinary pipes already on the board; replaceable
  without penalty.

### Levels and passwords

The 36 levels follow the original's progression: open grids, then walls,
reservoirs (level 4), one-way pipes (level 9), end pieces (level 13) and
pre-placed pipes (level 17), with the countdown getting shorter and the flooz
faster all the way up. Passwords are shown every four levels and can be entered
on the title screen (`HAHA`, `GRIN`, `REAP`, `SEED`, `GROW`, `TALL`, `YALI`,
`OOZE`).

The level layouts are a reconstruction of the original's structure and feature
schedule rather than a byte-exact rip of the 1989 data. Level data lives in
[`js/levels.js`](js/levels.js) as plain text maps, so editing or adding levels
is a matter of changing a few characters:

```
.  empty        #  wall           ^ > v <  start (arrow = flow direction)
n e s w  end piece (opening side)  =  |     reservoir (horizontal / vertical)
R L U D  one-way pipe (flow east / west / north / south)
-  I  +  pre-placed straight / vertical / cross    1 2 3 4  pre-placed corners NE NW SE SW
```

Levels without an explicit start get a random start position and direction,
like the original.

## Project layout

```
index.html           page, HUD and modals
css/style.css        styling (dark admin palette)
js/levels.js         the 36 level maps and timings
js/game.js           rules engine: flow simulation, scoring, placement, cleanup
js/render-common.js  palette and drawing helpers shared by both renderers
js/render-flat.js    classic top-down renderer
js/render-iso.js     2.5D isometric renderer
js/audio.js          WebAudio synthesised sound effects
js/main.js           input, HUD, modals, dispenser and the main loop
```

The engine (`PD.Game`) is renderer-agnostic. A renderer implements
`draw(game)`, `hitTest(x, y)` and `drawPieceIcon(ctx, kind, x, y, size)`, so a
third look can be dropped in without touching the rules.

## Running locally

Any static file server works, for example:

```
python -m http.server 8765
```

then open <http://localhost:8765/>. Opening `index.html` directly from disk
also works — the game uses plain scripts, not ES modules.
