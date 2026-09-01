---
name: build-bot-crossing
description: Build a Bot Crossing style ambient visualiser — a three.js world that reads a coding agent's local session files and draws every live thread as a character in a place, rather than as a row in a list. Use this whenever someone wants to visualise Claude Code / Codex / OpenCode sessions spatially, build a "my agents as a village/colony/city" dashboard, render many agent threads as an explorable 3D scene, or add a new harness adapter to Bot Crossing. Also use it for the hard parts in isolation: instancing hundreds of animated characters in one draw call, sticky spatial layouts that do not reshuffle, reading agent session state off disk, or depth-of-field and atlas-driven shading in three.js.
---

# Building Bot Crossing

Bot Crossing turns the coding-agent threads on your machine into a colony you can look at.
Each repo is a hex zone, each thread an astronaut with a building, and the state of the thread
decides what the astronaut does. When one needs you it stops and waits, and clicking it opens
that thread back in whichever harness it came from.

This skill is the build guide. It is opinionated about *order* and about the handful of
decisions that are genuinely load-bearing, because most of the cost of building this is not
writing the code — it is discovering, one at a time, the ten things that look fine in
isolation and fall apart once there are three hundred threads on screen.

## What you are actually building

Four layers, and they are worth keeping honestly separate:

1. **A reader.** Finds agent sessions on disk and normalises them into one thread shape.
   Knows nothing about rendering.
2. **A mapper.** Turns that thread list into a world: which repo owns which tiles, which
   thread owns which building, what each character should be doing.
3. **A renderer.** Draws it fast enough that hundreds of characters cost nothing at rest.
4. **A thin server.** Serves the page, exposes the reader over HTTP, and hands a thread
   back to its harness when you click it.

The reason to keep 1 separate from 2–4 is that it is the only part that differs per harness.
Get that seam right and supporting a second agent is one new file. Get it wrong and it is a
rewrite. See `references/harness-adapters.md` for the contract.

## Build in this order

Wrong order is the main way this project wastes a week.

1. **The reader, alone, printed to a terminal.** No graphics. You need to know what the data
   actually looks like — how many threads, how stale, how many are duplicates of each other —
   before any decision about drawing them is meaningful. Real session directories are messier
   than you expect.
2. **The world, empty.** Terrain, sky, camera. No agents. Get the camera feeling right here,
   because you will use it constantly for the rest of the build and every hour it is annoying
   is an hour taxed on everything after.
3. **Plots and the layout algorithm.** Static fake data. This is where the *sticky layout*
   problem lives, and it is much easier to reason about without characters moving around.
4. **Buildings.** Still fake data. Merged geometry, one draw call each.
5. **Characters, instanced from the start.** Do not build a per-character `SkinnedMesh` and
   plan to optimise later — the fix is architectural, not a tweak. See below.
6. **Behaviour, navigation, then polish.**

## The decisions that carry the whole thing

### One instanced draw for the entire crew

Hand-animated clips are not instanceable the naive way: three.js skins a `SkinnedMesh` from a
`Skeleton` per character, so three hundred threads means three hundred draw calls and three
hundred skeletons stepped on the CPU every frame.

Bake instead. Sample every clip at a fixed rate once at load, write each frame's bone matrices
into a float texture, and give each instance a single float — the frame it is on. Skin in the
vertex shader upstream of three's own instancing so the skinned vertex still passes through
`instanceMatrix`. The crew becomes one draw whether there are six of them or six hundred.

Everything a character *wears* — helmet, visor, pack, antenna — is its own `InstancedMesh`
across the whole crew, pinned by reading the baked head/chest transforms rather than
evaluating a skeleton.

This is the single highest-leverage decision in the project, and it is very painful to retrofit.

### The layout has to be sticky

The obvious implementation — sort repos by thread count, assign tiles in order — is wrong, and
wrong in a way that is invisible until you use it. One thread appearing anywhere changes the
sort, the sort changes the tiles, and the whole map re-lays itself. A zone you were watching
jumps across the screen because a *different* repo gained a thread.

Make the previous arrangement an input to the next one. A repo that still needs the same number
of tiles keeps exactly the tiles it had; one that grew keeps them and claims neighbours; one
that shrank gives back what it claimed most recently, so growing and shrinking returns it to
precisely the shape it started in. Only a never-placed repo gets placed at all. Persist it.

Anchor each zone to its **root** tile rather than the centroid of its tiles, or gaining a tile
drags the zone's buildings and label sideways.

### Behaviour precedence must be single-sourced

Decide once, in one ordered list, what a thread's state means — errored beats running beats
merged beats unread beats idle — and have both the character's behaviour and any list UI read
that same function. If they can disagree, they eventually will, and a character cheerfully
hammering while its card says it errored destroys trust in the whole display faster than any
rendering bug.

Give a badge only to states that want something from you. With most of a real thread list
sitting quiet, a symbol over every head buries the one that matters.

### One writer for persisted state

The browser owns the state file and writes it whole; the server only ever touches the
harness's own records. If both write it, a save from a page holding older state silently drops
every change made since that page loaded.

Write through a temp file and rename, so a crash cannot truncate it.

### Touch the harness's data as little as possible

Read freely; write one field. Bot Crossing sets exactly one archive flag on the harness's own
session record and nothing else. That restraint is what makes it safe to point at a directory
full of real work, and it is worth defending against every convenient-seeming exception.

Expect the harness to overwrite your flag — agents rewrite their session records from memory.
Keep your own list and re-assert on every scan rather than assuming the write stuck.

## Rendering traps

There are about a dozen of these and each one costs half a day to rediscover. They are written
up with the reasoning in **`references/rendering-traps.md`** — read it before writing the
renderer, not after. The short list, so you know what is in there:

- Deck height has to clear the roughest terrain any plot can be dealt, or ground pokes through.
- Ground scatter must be rebuilt when plot footprints change, because the world is built before
  the first roster arrives.
- Closed kit models must render `FrontSide`; open procedural shells must render double-sided
  with a `BackSide` shadow pass. Getting this backwards gives you either see-through hulls or a
  colony of flickering surfaces.
- Render scale is a share of the *display's* resolution, not of CSS pixels.
- A separable blur's tap spacing must scale with its radius, or a wide blur becomes visible
  copies of the image.
- Post-processing chains with an odd number of buffer swaps alternate which render target holds
  the scene — so anything sampling the depth texture must ask which buffer it is in *this*
  frame.
- `matrixWorld` only refreshes during a render, so anything reading a world position after
  moving objects but before drawing gets a stale (often identity) matrix.

## Art without an artist

Use CC0 model kits and do the work in the packer, not by hand. One 8×4 gradient atlas shared
by every model means a nine-part building still merges to one geometry and one draw call, and
a *cell index* becomes a stable name for a material — which lets one shader repaint a single
swatch into each repo's accent colour, light the window swatch after dark, and give a flat
texture real roughness and metalness per cell.

Retargeting animations onto one rig is the step everyone misses; merging glTF documents brings
each animation's private copy of the skeleton along, and the result loads without a single
warning and renders the entire crew in its bind pose. Details in
**`references/asset-pipeline.md`**.

## Verify with numbers, not vibes

This kind of project fails quietly — a character walks through a wall once every few minutes, a
path is subtly wrong, a blur is imperceptibly stronger on one machine. Instrument it and quote
real figures:

- Path legs run, and how many crossed a building (target: zero).
- Agent-frames simulated, and how many penetrated geometry (target: zero).
- Characters settled, closest approach between any two, standing spots left inside an obstacle.
- Draw calls at rest with the full roster on screen.
- Millisecond cost of each post pass, measured with a GPU sync, not wall-clock guesswork.

When you change something visual, capture the same frame before and after and diff it. A
static scene that differs frame to frame is a bug, and it is much easier to catch with a pixel
diff than with your eyes.

## Getting a harness's data

Every agent stores sessions differently, and none of it is documented API. The reliable method
is to find the directory, read one file, and let the shape tell you what it is — then handle
the messy cases: two records pointing at one transcript, records whose process died, sessions
that exist only as a raw transcript with no metadata at all.

`references/harness-adapters.md` has the adapter interface, the normalised thread shape, and
notes on where known harnesses keep their state.
