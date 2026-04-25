# PrototypeEnvironment — Oven Integration & Playback

`PrototypeEnvironment` is a `SceneEnvironment` subclass that serves as the primary consumer of the Oven physics worker. It sets up a 3D scene with ThreeJS visuals, drives the Oven worker for deterministic simulation, and bridges between the React UI and the worker via window events.

## File Relationships

```
┌──────────────────────────────┐
│       Synthesis.tsx           │  Renders OvenActionBar when prototypeUIEnabled
│  (React app root)            │
└──────────┬───────────────────┘
           │ renders
           ▼
┌──────────────────────────────┐     window "ovenAction"    ┌──────────────────────────────┐
│     OvenActionBar.tsx         │ ─────────────────────────▶ │  PrototypeEnvironment.ts     │
│  (React UI component)        │                             │  (SceneEnvironment subclass)  │
│                              │ ◀───────────────────────── │                              │
│  Slider, Play/Pause, Reset   │     window "ovenResult"    │  ThreeJS meshes, event wiring │
└──────────────────────────────┘                             └──────────┬───────────────────┘
                                                                        │ postMessage
                                                                        ▼
                                                             ┌──────────────────────────────┐
                                                             │     OvenWorker.ts             │
                                                             │  (Web Worker + OvenSystem)    │
                                                             └──────────────────────────────┘
```

## SceneEnvironment Base Class

`PrototypeEnvironment` implements the abstract `SceneEnvironment` interface:

| Method | Purpose |
|---|---|
| `createEnvironment()` | Sets up lights, skybox, ground, ThreeJS meshes, the Oven worker, and event listeners |
| `destroyEnvironment()` | Tears down everything: worker, event listeners, meshes, lights, skybox, ground |
| `updateEnvironment(deltaTime)` | Per-frame updates: skybox follows camera, ground focus point updates |
| `updateGraphicsSettings()` | Currently a no-op |
| `getEnvironmentContextData()` | Returns context menu items (right-click menu) |

The environment is activated when `Synthesis.tsx` calls `World.sceneRenderer.setEnvironment(new PrototypeEnvironment())` in the prototype startup path.

## Coordination with the Oven Worker

### Lifecycle

```
createEnvironment()
    │
    ├─ new OvenWorker()
    ├─ addEventListener("message", handleOvenResponse)
    ├─ addEventListener("error", ...)
    ├─ addEventListener("ovenAction", handler)    ← window event from UI
    │
    │  (worker module loads WASM asynchronously)
    │
    ▼  Worker posts Loaded
handleOvenResponse(Loaded)
    │
    ├─ sendOven(Init)
    │
    ▼  Worker posts Ready
handleOvenResponse(Ready)
    │
    └─ setupOvenScene()
        ├─ AddBody "boxA" (fixed) + create ThreeJS mesh
        ├─ AddBody "boxB" (dynamic) + create ThreeJS mesh
        ├─ AddJoint "hingeAB" (hinge, Z-axis)
        ├─ SaveState (initial checkpoint)
        └─ SetupRecorder (60fps, 300 frame buffer)
```

### Message Flow

The environment never sends messages directly from UI events. Instead:

1. **UI dispatches `window` event** → Environment handler translates to worker messages
2. **Worker posts response** → Environment handler updates ThreeJS meshes and dispatches `window` event back to UI

This keeps the React UI completely decoupled from the worker and the Oven protocol.

## Event Bridge: UI ↔ Environment

### `ovenAction` (UI → Environment)

Dispatched by `OvenActionBar.tsx`, consumed by `PrototypeEnvironment._ovenActionHandler`.

| `detail.action` | What the environment does |
|---|---|
| `"simulate"` | Clears recording state, sends `SaveState` → `Simulate(2400 steps)` → `GetBodyStates` to the worker |
| `"reset"` | Clears recording state, sends `ResetState` → `GetBodyStates` to the worker |
| `"scrub"` | Calls `scrubToNormalized(detail.t)` to interpolate and apply a recording frame (no worker message) |

### `ovenResult` (Environment → UI)

Dispatched by `PrototypeEnvironment.handleOvenResponse`, consumed by `OvenActionBar`.

| `detail.action` | When | Extra data |
|---|---|---|
| `"simulateDone"` | After `BodyStates` response arrives | `totalFrames: number` — total keyframes in the flattened recording |
| `"error"` | After a `Result` with `success: false` | — |

## ThreeJS Visual Representation

### Box Definitions

Defined in the `OVEN_BOXES` constant array as `OvenBoxDef` objects:

```typescript
{ bodyId: "boxA", halfExtents: [0.5, 0.5, 0.5], position: [0, 0, 0], color: 0x4488ff, mass: 1.0, fixed: true }
{ bodyId: "boxB", halfExtents: [1.0, 0.5, 0.5], position: [1.5, 1, 0], color: 0xff6644, mass: 1.0 }
```

Each definition is used to create both:
- A physics body in the Oven (via `AddBody` message)
- A `THREE.Mesh` with `BoxGeometry` and `MeshStandardMaterial` in the scene

The `bodyId` string is the key that links each ThreeJS mesh to its corresponding Oven body.

### Updating Meshes

There are two paths for updating mesh transforms:

**1. Body states (end of simulation):** `applyBodyStates()` receives an `OvenBodyState[]` from the `BodyStates` response and directly sets each mesh's `position` and `quaternion` from the body's current transform.

**2. Recording scrub (playback/slider):** `scrubToNormalized(t)` interpolates between recorded keyframes — no worker round-trip needed since the recording data is held locally.

## Recording & Playback Pipeline

### Recording Data Flow

```
Simulate(2400 steps)
    │
    ├─ Worker captures keyframe every 4 steps (60fps @ 1/240s timestep)
    │  = 600 total frames
    │
    ├─ After 300 frames: flush → RecordingData chunk 1 (steps 0–1199)
    ├─ After 600 frames: flush → RecordingData chunk 2 (steps 1200–2399)
    │
    ▼  Environment accumulates chunks in _recordingChunks[]
    │
    ▼  On BodyStates response:
        flattenRecording()
            └─ Concatenates all chunks into _flatRecording: Map<bodyId, keyframes[]>
            └─ Sets _totalRecordedFrames = 600
        dispatch "simulateDone" with totalFrames: 600
```

### Flattening

`flattenRecording()` takes the array of recording chunks (each containing keyframes per body) and concatenates them into a single flat `Map<string, OvenBodyKeyframe[]>`. This is called once after simulation completes. The flat structure allows O(1) frame lookup by index during scrubbing.

### Interpolated Scrubbing

`scrubToNormalized(t: number)` where `t` is 0→1:

1. Computes a floating-point frame index: `t * (totalFrames - 1)`
2. Takes `floor` and `ceil` as the two bounding keyframes
3. Computes fractional `alpha` between them
4. For each body:
   - **Position:** `THREE.Vector3.lerpVectors(posA, posB, alpha)`
   - **Rotation:** `THREE.Quaternion.slerpQuaternions(quatA, quatB, alpha)`
5. Sets the mesh's `position` and `quaternion`

This produces smooth visual results even when the slider lands between discrete recorded frames.

## Cleanup

`destroyEnvironment()` tears down in order:

1. Remove the `ovenAction` window event listener
2. Terminate the worker (kills the background thread)
3. Remove and dispose all box meshes (geometry + material)
4. Remove scene objects (lights, skybox, ground)
5. Null all references

## Constants

| Constant | Value | Purpose |
|---|---|---|
| `OVEN_TIMESTEP` | `1/240` (s) | Physics timestep — matches the Oven's default |
| `SIMULATE_SECONDS` | `10` | Duration of each simulation run |
| `SIMULATE_STEPS` | `2400` | `10 / (1/240)` — total physics steps per run |
| `RECORDER_FRAMERATE` | `60` | Keyframes captured per simulated second |
| `RECORDER_MAX_FRAME_BUFFER` | `300` | Max frames buffered before the worker flushes to main thread |

## OvenActionBar.tsx — The UI Component

A React component rendered in `Synthesis.tsx` inside the `prototypeUIEnabled` block. Anchored to the bottom-center of the screen.

### States

| State | Initial | Purpose |
|---|---|---|
| `simulating` | `false` | True while the worker is running a simulation |
| `totalFrames` | `0` | Number of recorded frames; `> 0` means a recording exists |
| `scrubValue` | `0` | Slider position, 0–100 |
| `playing` | `false` | True during real-time playback animation |

### UI Modes

**No recording (`totalFrames === 0`):**
- "Simulate 10s" button (disabled while simulating, shows spinner)
- Reset button

**Recording available (`totalFrames > 0`):**
- Slider with frame counter label (`Frame 142/599`)
- Play/Pause button (replaces Simulate)
- Reset button (clears recording, returns to Simulate mode)

### Real-Time Playback

Play uses a `requestAnimationFrame` loop:
- Computes `durationMs` from `(totalFrames - 1) / 60 * 1000`
- Each tick advances `scrubValue` proportionally to wall-clock delta
- Dispatches `scrub` events continuously for smooth interpolation
- Auto-stops at end; restarts from beginning if already at 100%
- Manual slider drag pauses playback

### Extending

To add new actions (e.g. step-forward, speed control, loop toggle):
1. Add UI controls in `OvenActionBar.tsx`
2. Dispatch new `ovenAction` event details
3. Handle them in `PrototypeEnvironment._ovenActionHandler`
