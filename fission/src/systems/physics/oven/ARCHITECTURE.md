# Oven — Deterministic Physics Simulation Worker

The Oven is a background physics simulation system that runs Jolt Physics in a Web Worker, separate from the main-thread real-time `PhysicsSystem`. It is designed for high-fidelity, deterministic, offline simulation that completes as a batch job and sends results back for visualization.

## File Overview

| File | Role |
|---|---|
| `OvenProtocol.ts` | Shared message types, request/response interfaces, and data shapes |
| `OvenSystem.ts` | Self-contained Jolt physics world with body/joint/state/recording management |
| `OvenWorker.ts` | Web Worker entry point — routes messages to `OvenSystem`, posts responses |

## Architecture

```
┌─────────────────────┐       postMessage        ┌───────────────────┐
│   Main Thread       │ ──────────────────────▶  │   OvenWorker.ts   │
│                     │                          │                   │
│  PrototypeEnv /     │  ◀──────────────────────  │   OvenSystem.ts   │
│  any consumer       │       postMessage        │   (Jolt Physics)  │
└─────────────────────┘                          └───────────────────┘
        │  ▲                                            │
        │  │  window CustomEvents                       │
        ▼  │  ("ovenAction" / "ovenResult")             │
┌─────────────────────┐                     Uses OvenProtocol.ts
│  OvenActionBar.tsx   │                     for all message shapes
│  (React UI)          │
└─────────────────────┘
```

### Communication Flow

All communication between the main thread and the worker uses `postMessage` with plain objects conforming to `OvenProtocol.ts` interfaces. Every message has a `messageType` discriminant from the `OvenMessageType` enum.

**Main thread → Worker:** `OvenRequest` union type (Init, Configure, AddBody, Simulate, etc.)

**Worker → Main thread:** `OvenResponse` union type (Loaded, Ready, Result, BodyStates, RecordingData, Error)

The React UI (`OvenActionBar`) does not communicate with the worker directly. Instead, it dispatches `window` `CustomEvent`s (`ovenAction`) that the environment class listens for, and receives results via `ovenResult` events.

### Worker Initialization Handshake

The worker module has a top-level `await` in its import chain (`JoltSyncLoader.ts` initializes the Jolt WASM module). The `self.addEventListener("message", ...)` at the bottom of the worker only runs after this completes. Messages posted before that point are lost.

To handle this, the worker posts a `Loaded` message immediately after registering its listener. The main thread waits for `Loaded` before sending `Init`:

```
Main Thread                    Worker
    │                            │
    │  new OvenWorker()          │
    │ ──────────────────────▶    │  (module loading, WASM init)
    │                            │  ...
    │                            │  addEventListener("message", ...)
    │    ◀────────────────────   │  postMessage({ Loaded })
    │  postMessage({ Init })     │
    │ ──────────────────────▶    │  new OvenSystem()
    │    ◀────────────────────   │  postMessage({ Ready })
    │                            │
```

## OvenProtocol.ts

Defines the full contract. Key design decisions:

- **Plain tuples for spatial data** — `Vec3Tuple = [number, number, number]` and `QuatTuple = [number, number, number, number]` serialize cleanly across the worker boundary without any library dependency (no THREE.js, no Jolt types).
- **String IDs for bodies and joints** — The caller assigns IDs (e.g. `"boxA"`, `"hingeAB"`), not Jolt's internal numeric IDs. This keeps the protocol decoupled from Jolt internals.
- **Optional `requestId`** — Every `IOvenMessage` has an optional `requestId` field for correlating responses to specific requests. Not currently used for sequencing but available for future async patterns.

### Request Types

| Message | Purpose |
|---|---|
| `Init` | Create (or re-create) the physics world |
| `Configure` | Set gravity, timestep, substeps |
| `AddBody` | Add a box body with position, rotation, mass, fixed flag, friction, restitution |
| `MoveBody` | Teleport a body and/or set velocities |
| `RemoveBody` | Remove a body from the simulation |
| `AddJoint` | Add a fixed, hinge, or slider joint between two bodies |
| `RemoveJoint` | Remove a joint |
| `Simulate` | Run N physics steps |
| `SaveState` / `ResetState` | Snapshot and restore body transforms + velocities (named slots) |
| `GetBodyStates` | Query current position/rotation/velocity of all bodies |
| `SetupRecorder` | Configure the recording system (framerate, max buffer size) |

### Response Types

| Message | Purpose |
|---|---|
| `Loaded` | Worker module finished loading, ready to receive messages |
| `Ready` | `OvenSystem` initialized successfully (response to `Init`) |
| `Result` | Success/failure acknowledgment for most commands |
| `BodyStates` | Current transform + velocity data for all bodies |
| `RecordingData` | A chunk of recorded keyframes with step range |
| `Error` | Unrecoverable error |

## OvenSystem.ts

A self-contained Jolt physics world. Key differences from the main-thread `PhysicsSystem`:

- **`mDeterministicSimulation = true`** — Guarantees reproducible results given the same inputs.
- **Simplified collision layers** — Two layers (static + dynamic) instead of the full robot/field/gamepiece layer hierarchy.
- **No contact listeners** — Pure simulation without event dispatch.
- **String-keyed body/joint maps** — Bodies and joints are tracked by caller-provided string IDs.

### Bodies

Currently only supports box shapes (`BoxShape`). A body can be:
- **Dynamic** — Has mass, responds to forces and collisions.
- **Static/Fixed** — `fixed: true` or no mass. Immovable.

### Joints

Three joint types:
- **Fixed** — Locks two bodies together at an anchor point.
- **Hinge** — Revolute joint around a specified axis, with optional angular limits.
- **Slider** — Prismatic joint along a specified axis, with optional linear limits.

### Save/Reset

Bodies' full state (position, rotation, linear velocity, angular velocity) can be saved to named slots and restored later. The default slot is `"__default__"`.

### Recording System

The recorder captures keyframes during simulation for later playback:

1. **Setup** — `setupRecorder(framerate, maxFrameBuffer)` computes `stepsPerFrame` from the framerate and current timestep. For example, at 60fps with a 1/240s timestep, a frame is captured every 4th step.

2. **During simulation** — `simulate()` captures a keyframe (position + rotation for every body) at the configured interval. When the buffer reaches `maxFrameBuffer` frames, it calls the flush callback, which posts a `RecordingData` message back to the main thread. This prevents unbounded memory growth in the worker.

3. **End of simulation** — Any remaining buffered frames are flushed.

4. **Flush callback** — Set by the worker at init time via `setRecordingFlushCallback`. This keeps `OvenSystem` decoupled from the messaging layer.

Each `RecordingData` response contains:
- `bodies` — Array of `{ bodyId, keyframes[] }`, where each keyframe has `position` and `rotation`.
- `firstStep` / `lastStep` — The simulation step range this chunk covers.

## OvenWorker.ts

Thin message dispatcher. It:
1. Imports `OvenSystem` (which triggers WASM loading via top-level await).
2. Registers a `message` event listener that routes each `OvenRequest` to the appropriate `OvenSystem` method.
3. Posts `Loaded` after the listener is registered.
4. On `Init`, creates the `OvenSystem` and wires the recording flush callback.
5. Wraps all handler logic in try/catch — errors are returned as `Result` messages with `success: false`.

### Important: Jolt type import

`OvenSystem.ts` must use `import type Jolt from "@azaleacolburn/jolt-physics"` (with `type`). The project has `isolatedModules: true` in `tsconfig.json`, so a value import would not be elided and would cause the worker module to fail during loading. The runtime Jolt instance comes from `JOLT` via `JoltSyncLoader`.

## Consumer Integration

### PrototypeEnvironment.ts

The current consumer. It:
- Instantiates the worker via Vite's `?worker` import.
- Creates ThreeJS box meshes that mirror the physics bodies.
- Listens for `ovenAction` window events from the UI and translates them to worker messages.
- Receives `RecordingData` chunks and flattens them into a single timeline per body.
- Supports scrubbing: given a normalized 0→1 position, finds the two bounding keyframes and interpolates (lerp for position, slerp for rotation) to update the ThreeJS meshes.

### OvenActionBar.tsx

React component anchored to the bottom of the screen:
- **Before recording:** "Simulate 10s" button that triggers simulation.
- **After recording:** Play/Pause button for real-time playback, plus a scrub slider showing frame position. Reset clears the recording and returns to the simulate button.

## Extending the Oven

### Adding new shape types

1. Add shape parameters to `OvenAddBodyMessage` in `OvenProtocol.ts` (e.g. a `shapeType` discriminant, sphere radius, etc.).
2. Update `OvenSystem.addBody()` to create the appropriate Jolt shape.
3. Update the consumer to create matching ThreeJS geometry.

### Adding new joint types

1. Add the type string to `OvenJointType` in `OvenProtocol.ts`.
2. Add a case to `OvenSystem.addJoint()`.
3. Add any joint-specific parameters to `OvenAddJointMessage`.

### Adding new message types

1. Add the enum value to `OvenMessageType`.
2. Define the request/response interface extending `IOvenMessage`.
3. Add to the `OvenRequest` or `OvenResponse` union.
4. Add a case in `OvenWorker.ts`'s switch statement.
5. Add the method to `OvenSystem`.

### Motor/force inputs during simulation

The current `Simulate` message runs all steps in a single batch with no per-step input. To support motor control or external forces during simulation, consider:
- A new message type that provides a schedule of inputs keyed by step number.
- Or breaking simulation into smaller step batches with input messages between them.
