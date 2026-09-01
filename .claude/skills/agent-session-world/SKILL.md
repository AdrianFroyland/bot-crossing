---
name: agent-session-world
description: >-
  Build a small living world driven by your own coding-agent sessions — a colony, a village,
  an aquarium, an office, a city block — where each thread is a character doing something and
  the world reflects what is actually happening on your machine. Use this whenever someone
  wants to make a game, toy, ambient display, screensaver or dashboard out of their Claude
  Code / Codex / OpenCode sessions, turn their agent threads into characters or creatures,
  visualise many concurrent sessions spatially instead of as a list, or add a new harness to
  an existing one. Also reach for it for the hard parts on their own — instancing hundreds of
  animated characters in one draw call, spatial layouts that stay put instead of reshuffling,
  reading agent session state off disk, or atlas-driven shading and depth of field in three.js.
---

# Worlds built from your coding sessions

The idea is simple and holds up in a lot of shapes: the agent sessions on your machine already
have state — running, waiting on you, errored, idle, finished — and that state is far more fun
to look at as *a place* than as a list. Give each thread a character, give each repo somewhere
to live, and let what the thread is doing decide what the character does.

Bot Crossing, the project in this repo, is one instance: a space colony where each thread is an
astronaut building on its repo's plot. It could as easily be fish in a tank, villagers in a
valley, or workers in a workshop. The metaphor is yours. Almost everything below is the same
regardless of which one you pick.

## Pick the metaphor, then the mapping

The metaphor matters much less than the mapping. Before writing anything, fill in a table like
this for your world, because it is the actual design:

| The world | Your sessions |
| --- | --- |
| One region / zone / tank | One repo |
| One character | One thread |
| How built-up its dwelling looks | How much work the thread has done |
| A character stopping and waiting | The thread needs your reply |
| A character slumped or sparking | The thread errored |
| Walking in from somewhere | The thread just appeared |
| Walking off | You archived it |

Two rules make this feel alive rather than arbitrary:

**Every visible thing should mean something.** If a character sits down, it should be because
that thread has been quiet, not because sitting looks nice. The moment decoration and data mix,
you stop trusting any of it.

**Only signal what wants attention.** With most of a real thread list sitting idle, a badge over
every head buries the one you need to see. Reserve the loud states for the ones that actually
want you.

## What you are building

Four layers, worth keeping honestly separate:

1. **A reader.** Finds agent sessions on disk and normalises them into one thread shape. Knows
   nothing about rendering.
2. **A mapper.** Turns that thread list into world state — who lives where, what everyone is
   doing.
3. **A renderer.** Draws it fast enough that hundreds of characters cost nothing at rest.
4. **A thin server.** Serves the page, exposes the reader over HTTP, and hands a thread back to
   its agent when you click it.

Layer 1 is the only part that differs per agent. Get that seam right and supporting a second
one is a single new file; get it wrong and it is a rewrite. See
`references/harness-adapters.md`.

## Build in this order

Order matters more than it looks, because each step makes the next one easier to judge.

1. **The reader alone, printed to a terminal.** No graphics. You need to see what the data
   actually looks like — how many threads, how stale, how many are duplicates of each other —
   before any decision about drawing them means anything. Real session directories are messier
   than you expect, and this shapes the whole design.
2. **The world, empty.** Ground, sky, camera. No characters. Get the camera feeling right here,
   because you will be using it constantly for everything after.
3. **Regions and the layout rule.** Static fake data. The stickiness problem below lives here,
   and it is far easier to reason about before anything is moving.
4. **Dwellings.** Still fake data. One merged geometry and one draw call each.
5. **Characters, instanced from the very start.** Not a per-character mesh you plan to optimise
   later — the fix is architectural, not a tweak.
6. **Behaviour, then navigation, then polish.**

Resist starting at step 5. It is the fun part and the least useful thing to have working when
the data underneath is still a guess.

## The decisions that carry the whole thing

### One instanced draw for every character

Hand-animated clips are not instanceable the naive way: three.js skins a `SkinnedMesh` from a
`Skeleton` per character, so hundreds of threads means hundreds of draw calls and hundreds of
skeletons stepped on the CPU every frame.

Bake instead. Sample every clip once at load, write each frame's bone matrices into a float
texture, and give each instance a single number — the frame it is on. Skin in the vertex shader
upstream of three's own instancing, so the skinned vertex still passes through `instanceMatrix`.
The whole crowd becomes one draw whether there are six of them or six hundred.

Anything a character *wears* is its own instanced mesh across the whole population, positioned
by reading transforms written during the bake rather than by evaluating a skeleton.

This is the highest-leverage decision here and the most painful to retrofit, which is why it
belongs at step 5 rather than later.

### The layout has to stay put

The obvious implementation — sort regions by size, hand out ground in order — is wrong in a way
that stays invisible until you actually use the thing. One new thread changes the sort, the sort
changes the ground, and the entire map rearranges itself. A region you were watching jumps
across the screen because a *different* repo gained a thread.

Make the previous arrangement an input to the next one. Something that still needs the same
amount of room keeps exactly the ground it had; something that grew keeps its ground and claims
neighbours; something that shrank gives back what it claimed most recently, so growing and
shrinking again returns it to the shape it started in. Only a never-placed region gets placed.
Persist the result so the map survives a reload.

Anchor each region to a fixed corner rather than the centre of the ground it happens to hold,
or gaining a tile drags everything in it sideways.

A map you can learn is the entire value proposition of doing this spatially. A map that
reshuffles is worse than a list.

### Decide state once

Put the precedence in one ordered function — errored beats running beats finished beats waiting
beats idle — and have both the character's behaviour and any list UI read it. If two places can
disagree about what a thread is doing, eventually they will, and a character cheerfully working
away next to a card saying it crashed destroys trust in the whole display.

### One writer for anything you persist

The page owns your state file and writes it whole; the server only touches the agent's own
records. If both write it, a save from a page holding older state silently drops every change
made since that page loaded. Write through a temp file and rename so a crash cannot truncate it.

### Touch the agent's data as little as possible

Read freely; write almost nothing. Bot Crossing sets exactly one archive flag on the agent's own
session record and nothing else. That restraint is what makes it safe to point at a directory
full of somebody's real work, and it is worth defending against every convenient-seeming
exception.

Expect the agent to overwrite your flag — these tools commonly rewrite session records from
memory. Keep your own record of intent and re-assert it on the next scan rather than assuming a
write stuck.

## Rendering

There is a set of graphics problems you will meet in roughly the order you build things, and
each one looks like a small detail while being anything but. They are written up with the
reasoning in **`references/rendering-traps.md`** — read it before writing the renderer rather
than after. In short, it covers:

- Raised ground has to clear the roughest terrain it could sit on, and scatter has to be rebuilt
  when regions change shape.
- Closed model-kit pieces must be single-sided; open procedural shells must be double-sided with
  a back-side shadow pass. Getting it backwards gives either see-through hulls or a world of
  flickering surfaces.
- Generated primitives have the wrong UVs for anything you draw on them.
- Render scale is a share of the *display's* resolution, not of CSS pixels.
- A separable blur's taps must be spaced as a fraction of its radius.
- Post chains with an odd number of buffer swaps alternate which target holds the scene, so
  anything sampling depth must ask which buffer it is in this frame.
- `matrixWorld` only refreshes during a render, so reading a world position after moving things
  but before drawing gets a stale matrix.

## Art without an artist

Use CC0 model kits and do the work in a packer. The property to look for is not polygon count
but whether every model shares **one** texture — that is what lets a many-part building merge to
a single geometry and a single draw call.

If that shared texture is a grid of flat swatches, a *cell index* becomes a stable name for a
material, and one shader can repaint a single swatch into each region's colour, light the window
swatch after dark, and give a flat texture real roughness and metalness per cell — no extra
materials, no extra draws.

Retargeting animations onto one skeleton is the step most people miss, and its failure mode is
confusing: merging glTF documents brings each animation's private copy of the rig along, and the
result loads without a single warning and renders everything in its bind pose. Details in
**`references/asset-pipeline.md`**.

## Verify with numbers

This kind of project fails quietly. A character walks through a wall once every few minutes; a
blur is imperceptibly stronger on one machine; a path is subtly wrong. Instrument it and quote
real figures rather than trusting your eye:

- Paths run, and how many crossed something solid (target: zero).
- Character-frames simulated, and how many penetrated geometry (target: zero).
- How many characters settled, and the closest approach between any two.
- Draw calls at rest with the full population on screen.
- Millisecond cost of each post-processing pass, measured with a GPU sync rather than
  wall-clock guesswork.

When you change something visual, render the same frame before and after and diff the pixels. A
static scene that differs between frames is a bug, and a diff catches it when eyes will not.

## Making it feel like a place

A few things do disproportionate work once the mechanics are right:

- **Give the camera weight.** Grabbing the ground and having the point under your cursor stay
  pinned there is worth more than any amount of scene detail.
- **Let characters route around things**, and apply collision separately on every step whether
  or not a path is being followed. Routing can fail; walking through a wall must not be what
  happens when it does.
- **Choose animation from motion that actually happened**, not from intended velocity, or
  characters moonwalk against walls.
- **Vary the small clocks.** Blink timers, idle fidgets and wander legs should each run on their
  own offset, or the crowd moves in unison and reads as a machine.
- **Let quiet be quiet.** Most threads are idle most of the time. A world where nothing is
  demanding attention should be pleasant to leave open, which is the whole point of an ambient
  display.
