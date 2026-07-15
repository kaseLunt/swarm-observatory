# Capture ritual — the fixed-dt clock

How the app produces reproducible captures (the README hero GIF, social card, tour clips). This
is capture **rung 2**: the deterministic capture clock. Its claim, precisely: the **playhead
timeline** of a capture — the `(tick, fraction)` at every captured frame — is bit-stable on any
machine. Visual *easing* (camera moves, ring scale, lead) is not yet capture-clocked; that is the
named rung-3 debt (see *Rung 3 — the visual delta seam* below). The hero-frame spec this serves
lives in `.superpowers/sdd/flip-readiness-package.md` §1a.

## Why a capture clock exists

The live app paces playback by the real per-frame **wall-clock** delta: `Timeline.tsx`'s draw
loop feeds `advancePlayhead(..., now - last, ...)`, where `now - last` is the elapsed time since
the previous animation frame. That delta varies with render timing, GPU speed, tab throttling,
and vsync — so playing "the same run" advances the playhead differently on different machines and
different runs. Fed to a screen capture, that variance makes "the same GIF" a different sequence
of frames every time. It is the same class of problem as the CI wall-clock saga: a value that must
be reproducible was being read from the environment.

The capture clock replaces the wall delta with a **fixed per-frame delta** during capture, and
only during capture. The captured playback *is* the real playback — it runs the identical
`advancePlayhead` math — but clocked deterministically, so frame _N_ is always the same playhead
position regardless of how fast the machine rendered to get there.

## Invoking a capture — `?capture=<fps>`

Add `capture` to the app URL:

| URL | Effect |
|---|---|
| `…/?run=e0&tick=37&ev=37` | normal load — **live wall-clock path, untouched** |
| `…/?run=e0&capture=30` | fixed-dt clock at 30 fps |
| `…/?run=e0&capture` | fixed-dt clock at the default fps (30) |
| `…/?run=e0&capture=<out-of-band or non-numeric>` | ignored — falls back to the live path |

The fps must sit in the practical capture band **1–240** (inclusive; fractional rates like 29.97
are legal). Anything outside — `0`, negatives, non-numeric, and pathological finite values like
`5e-324` (whose derived delta would be `Infinity`, snapping playback to the end) or `1e308` (a
near-zero-delta stall) — is rejected and the load falls back to the live path: this is a public
URL entry point, and a pasted link must never break a visitor's playback. As a second layer, the
clock refuses to arm unless the **downstream playback** the derived delta produces is sane: the
per-frame tick increment must be finite, must complete the run within a one-hour-at-240fps frame
budget (864 000 frames — every real artifact is seconds-to-minutes; anything slower is a stall,
not a capture), and must not clamp the run to its end on the first frame. This guards against
extreme *manifest* clock facts too (a malformed or future manifest's `dt_us` reaches the clock),
not just a bad fps.

`capture` is **never** emitted by `encodeLink`, so it can never ride a shared/copy-link URL into a
visitor's browser — it is a capture-harness affordance, not a view fact (the same discipline that
keeps verification state off the URL). Engaging it changes only the *pacing* of playback, never
what is drawn.

The clock arms once the run's model is ready, and derives its facts from the model alone —
`tickCount` plus the **model's own manifest** `dt_us`, the value parsed and verified with the
loaded bytes (never the separately-fetched `runs/index.json` metadata, which can fail or lag
independently of the load). It disarms on teardown / run-switch, so a stale run's fixed delta can
never outlive it.

**Capture pacing is speed-independent.** The fps alone encodes the capture rate: while a session
is engaged, the transport's speed multiplier is pinned to 1× on the capture path (`captureSpeed`,
the second half of the seam — the store speed passes through untouched when not capturing).
Without this, a `?speed=8&capture=1` deep link would arm past the downstream guard (which
validates at 1×) and then snap a short run to its end on the first captured frame at 8×. Arming
also pins the *store* speed to 1× so the speed UI reads the true effective rate. A mid-capture
speed write — a user keystroke, or a tour's internal `witnessSpeed` — updates the store
(display-only during capture) but never reaches the captured playhead, which stays a pure function
of the frame index: **the capture survives such writes deterministically.** The alternative,
treating a speed write as a capture-ending interrupt, was rejected: it would make the artifact
depend on whether and when a write landed — a new source of nondeterminism — and tour capture
(where `witnessSpeed` writes are routine) is rung-3 scope regardless, because tour dwells ride
wall-clock timers.

## The two tiers — how the fixed delta is derived

The fixed per-frame delta (`captureFrameDtMs` in `src/state/captureClock.ts`) is derived from the
run's recorded clock, keyed on the **same** `hasRealSimClock` partition the Hangar sim-clock uses
(one owner, keyed on `ASSUMED_DT_US`, never an id list):

- **Real-clock tier** (`f2a` / `f3a` / `f4` — manifest `dt_us = 125000µs`, a genuine timed sim):
  the delta is derived so the captured playback spans the run's **true sim duration**
  (`tickCount · dt_us`, e.g. 96 × 0.125 s = 12 s). This is the only tier that consults `dt_us`.
- **Assumed tier** (det-only `e0` / `f1`, and `f0` whose `dt_us` equals the assumption): the
  captured playback spans `WITNESS_RUN_SECONDS` — **identical to the live 1× cadence** on a machine
  pacing perfectly at `fps`. The assumed tier keeps its tick cadence; no real-time clock is
  fabricated for a run that has none. The delta reduces to `1000 / fps`.

The README hero is `f1` — the assumed tier — so the hero capture uses `1000 / fps` and plays at the
app's own witness-normalized cadence, just deterministically.

## The live path is untouched (§8)

The only seam on the live frame loop is the transport line's pair `frameDeltaMs(now - last)` /
`captureSpeed(s.speed)`. When capture is not engaged (the default, and always in the shipped app)
both are the **identity** — `now - last` and the store speed pass through unchanged, byte-identical
behavior. `captureClock.test.ts` pins both as executable guarantees (`frameDeltaMs(x) === x` and
`captureSpeed(x) === x` for every input while disengaged). `advancePlayhead` itself is unchanged.

## What "deterministic" is proven to mean here

The capture clock's job is to make the **playhead sequence** — the `(tick, fraction)` at every
captured frame — a pure function of the frame index. The claim was **narrowed in review** (round
2 — the earlier "deterministic playhead ⇒ deterministic frame stream" wording was an overclaim):
it is the playhead *timeline* that is bit-stable across machines, not every pixel of every frame.
What actually follows from a deterministic playhead:

- **Static and hold frames** (the hero's 1.5 s holds, any paused or settled beat) are pure
  functions of the playhead plus the immutable, verified model — stable everywhere.
- **Motion frames under eased camera work are NOT yet cross-machine bit-stable.** `Scene.tsx`'s
  `useFrame((state, delta))` drives the focus/trail/follow camera easing, the finale ring scale,
  and the predictive lead from **real renderer deltas** even while capture is engaged. In
  practice same-machine captures reproduce (same GPU, same pacing); bit-identical *motion* frames
  across machines require the rung-3 **visual delta seam** (below).

`captureClock.test.ts` proves it directly, as **two genuinely fresh capture sessions**, each
running the module's real lifecycle (clean state asserted → engage → `frameDeltaMs` called *per
frame* through the live seam → disengage → disengaged identity re-asserted):

1. **Two fresh sessions of the hero (`e0`, 75 ticks), each fed a *different* wall-jitter stream
   (two machines' timing), produce a bit-identical playhead sequence** — asserted equal both as raw
   strings and as digests. This proves both that no module state leaks across sessions and that the
   per-frame wall delta never reaches the playhead while capture is engaged.
2. **The fixed-dt sequence differs from a wall-clock-jittered one** — the same run driven through
   the same seam with capture *never engaged* (the pre-rung path exactly) diverges under a ±8%
   frame-timing wobble, so the flake this rung removes is real, not hypothetical.
3. Determinism holds on the real-clock tier, with a non-1× store speed passed and proven inert
   (two fresh sessions at the 4× notch match each other *and* a 1× session bit-for-bit).

### The boundary — stated honestly

- **In scope of this rung (deterministic, proven):** the playhead sequence — the frame *timeline*.
- **Visual easing (rung 3, named debt):** camera focus/trail/follow eases, finale ring scale, and
  predictive lead consume real renderer deltas in `Scene.tsx`'s frame loop — deterministic
  playhead, non-deterministic easing trajectory across machines. See the rung-3 section below.
- **Renderer:** pixel-level determinism depends on the WebGL/GPU rasterizer. The captures use ANGLE
  SwiftShader (the same software rasterizer the smoke suite pins via `--use-angle=swiftshader`) to
  make pixels reproducible; hardware GPUs may differ sub-pixel. A frame-buffer capture pipeline is
  **not** built at this rung — the deterministic seam this rung owns and proves is the playhead.
- **Encoder:** the GIF/MP4 encode is external `ffmpeg` (two-pass `palettegen` / `paletteuse`, per
  §1a), out of the app entirely. Given the same input frame sequence the encode is reproducible —
  and whether two machines produce that identical input sequence is governed by the scoping above:
  guaranteed for playhead-derived static/hold frames, rung-3 for eased-motion frames. The app makes
  no claim about ffmpeg's byte-identity beyond that.

## Rung 3 — the visual delta seam (named debt, not built)

Adjudicated out of rung 2's review wave rather than patched in: the camera rig (focus/trail/follow
easing, predictive lead) and the finale ring scale consume `useFrame`'s real renderer delta inside
`Scene.tsx` — PROTECT-adjacent, heavily-reviewed camera code that a capture fix must not casually
thread a new clock through. Until rung 3 lands, **treat cross-machine bit-identity claims as
playhead-only.** Rung 3 must:

1. **Route a capture-aware visual delta through the r3f frame loop:** every `useFrame((state,
   delta))` consumer that eases *visible* state (the camera arbitration in `Scene.tsx` /
   `camera.ts`, the finale ring scale, the predictive lead, the `motion.ts` lerp factors) reads
   the same fixed per-frame delta the playhead uses while capture is engaged — and the untouched
   renderer delta otherwise (the same §8 discipline as the Timeline seam).
2. **Prove it the way rung 2 proves the playhead:** a camera-state cross-jitter proof — two fresh
   capture sessions under *different* renderer-delta jitter streams must digest identical
   camera/easing state sequences.

## Flip regeneration ritual

The README hero slot regenerates from `f1` — the default run and cold-open star. The current
recipe (as actually run for the flip):

1. Build and serve the app (`npm run build`, then a static server — the smoke `vite preview` path
   works; pick your capture port).
2. Launch a Playwright browser on the ANGLE SwiftShader software rasterizer (the same
   `--use-angle=swiftshader` the smoke suite pins) and open the hero deep link with the rung-2
   capture clock armed: `…/?run=f1&sel=1:0&capture=30`. `sel=1:0` selects the drone the
   follow-camera tracks; the capture opens at rest with the det-only provenance panel in frame
   (tour-nudge pre-seeded off), then plays the live trail + telemetry through the late corridor
   and loops.
3. Record with Playwright's **video** capture while the capture clock drives the playhead —
   deliberately not frame-by-frame screenshots. Screenshotting was the first approach tried and
   was rejected: an ANGLE SwiftShader screenshot costs ~1.1 s each, far too sparse to resolve
   motion at the target fps. Video capture sidesteps that cost; the tradeoff is the re-timing step
   below.
4. Re-time the recorded video uniformly with `ffmpeg` (~4.8×) to bring it to the target cadence,
   then encode with the two-pass `ffmpeg palettegen`/`paletteuse` pipeline (100 colors, Bayer
   dither). Write `docs/media/hero-f1-flight.gif` — 960×600, 12 fps, 68 frames (≈5.7 s),
   7,515,084 bytes.

**Claim rider, read against the rung-2 boundary above:** because these frames come from a video
recording re-timed by a uniform `ffmpeg` factor — not from the capture clock sampling the playhead
frame-by-frame — the *motion* in this GIF is a **same-machine artifact**, no stronger a claim than
the rung-2 boundary already states: the playhead timeline and any static/hold frames are bit-stable
on any machine; the eased motion between them is proven only on the machine that recorded it.
Frame-by-frame capture (sampling the fixed-dt clock 1:1, no video or re-timing) is the rung-3-era
upgrade — it removes the re-timing step entirely once a faster rasterizer makes per-frame
screenshots cheap enough to pace the target fps directly.

Because the playhead is deterministic, re-running the regeneration on any machine yields the same
frame *timeline*, and f1's hold / at-rest frames are stable anywhere — the hero is reproducible,
not a one-off screen grab. Its eased motion — captured here via video plus a uniform `ffmpeg`
re-time — reproduces in practice on the same machine; expect cross-machine bit-identity of the
motion frames only once rung 3's visual delta seam lands **and** frame-by-frame capture replaces
the video/re-time step.

### Historical: the e0 hero recipe (superseded)

Before the flip to `f1`, the hero slot regenerated from `e0`'s lit causal chain, captured
frame-by-frame (no video or re-timing — `e0`'s script tolerated the ~1.1 s-per-screenshot cost).
Kept here only for the provenance of `docs/media/hero-e0-chain.gif`, which the README retains as a
historical reference. **This is not the current recipe** — do not follow it to reproduce the
current README hero:

1. Open `…/?run=e0&tick=37&ev=37&capture=30` — wait for the ceremony to settle (~1 s after
   model-ready).
2. Drive the scripted hero motion (hold → `← cause` ×2 → hold → loop).
3. Capture frames directly at the fixed fps — no re-timing needed at this cadence/script.
4. Encode with the same two-pass `ffmpeg` settings; write `docs/media/hero-e0-chain.gif`.
