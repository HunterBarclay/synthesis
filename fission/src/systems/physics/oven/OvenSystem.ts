import JOLT from "@/util/loading/JoltSyncLoader"
import type Jolt from "@azaleacolburn/jolt-physics"
import type {
    Vec3Tuple,
    QuatTuple,
    OvenBodyState,
    OvenBodyKeyframe,
    OvenRecordingBody,
    OvenJointType,
} from "./OvenProtocol"

const DEFAULT_TIMESTEP = 1.0 / 240.0
const DEFAULT_SUBSTEPS = 3
const DEFAULT_GRAVITY: Vec3Tuple = [0, -9.8, 0]

const LAYER_STATIC = 0
const LAYER_DYNAMIC = 1
const COUNT_OBJECT_LAYERS = 2

interface BodyRecord {
    id: string
    joltBody: Jolt.Body
    joltBodyId: Jolt.BodyID
}

interface JointRecord {
    id: string
    constraint: Jolt.Constraint
}

interface BodySnapshot {
    position: Vec3Tuple
    rotation: QuatTuple
    linearVelocity: Vec3Tuple
    angularVelocity: Vec3Tuple
}

interface RecorderConfig {
    framerate: number
    maxFrameBuffer: number
    stepsPerFrame: number
}

export type RecordingFlushCallback = (
    bodies: OvenRecordingBody[],
    firstStep: number,
    lastStep: number,
) => void

const DEFAULT_SAVE_SLOT = "__default__"

class OvenSystem {
    private _joltInterface: Jolt.JoltInterface
    private _physicsSystem: Jolt.PhysicsSystem
    private _bodyInterface: Jolt.BodyInterface

    private _timestep: number = DEFAULT_TIMESTEP
    private _substeps: number = DEFAULT_SUBSTEPS

    private _bodies: Map<string, BodyRecord> = new Map()
    private _joints: Map<string, JointRecord> = new Map()
    private _savedStates: Map<string, Map<string, BodySnapshot>> = new Map()

    private _recorder: RecorderConfig | undefined
    private _onRecordingFlush: RecordingFlushCallback | undefined

    public get timestep(): number { return this._timestep }
    public set timestep(v: number) { this._timestep = v }
    public get substeps(): number { return this._substeps }
    public set substeps(v: number) { this._substeps = v }

    constructor() {
        const joltSettings = new JOLT.JoltSettings()
        this.setupCollisionFiltering(joltSettings)

        this._joltInterface = new JOLT.JoltInterface(joltSettings)
        JOLT.destroy(joltSettings)

        this._physicsSystem = this._joltInterface.GetPhysicsSystem()
        this._bodyInterface = this._physicsSystem.GetBodyInterface()

        this._physicsSystem.SetGravity(new JOLT.Vec3(...DEFAULT_GRAVITY))
        const settings = this._physicsSystem.GetPhysicsSettings()
        settings.mDeterministicSimulation = true
        settings.mSpeculativeContactDistance = 0.06
        settings.mPenetrationSlop = 0.005
    }

    public configure(gravity?: Vec3Tuple, timestep?: number, substeps?: number): void {
        if (gravity) {
            this._physicsSystem.SetGravity(new JOLT.Vec3(...gravity))
        }
        if (timestep !== undefined) {
            this._timestep = timestep
        }
        if (substeps !== undefined) {
            this._substeps = substeps
        }
    }

    public addBody(
        bodyId: string,
        halfExtents: Vec3Tuple,
        position: Vec3Tuple,
        rotation: QuatTuple,
        mass?: number,
        fixed?: boolean,
        friction?: number,
        restitution?: number,
    ): void {
        if (this._bodies.has(bodyId)) {
            throw new Error(`Body '${bodyId}' already exists`)
        }

        const shape = new JOLT.BoxShape(new JOLT.Vec3(...halfExtents), 0.01)
        const pos = new JOLT.RVec3(...position)
        const rot = new JOLT.Quat(...rotation)
        const isDynamic = !fixed && mass !== undefined && mass > 0
        const creationSettings = new JOLT.BodyCreationSettings(
            shape,
            pos,
            rot,
            isDynamic ? JOLT.EMotionType_Dynamic : JOLT.EMotionType_Static,
            isDynamic ? LAYER_DYNAMIC : LAYER_STATIC,
        )

        if (isDynamic) {
            creationSettings.mOverrideMassProperties = JOLT.EOverrideMassProperties_CalculateInertia
            creationSettings.mMassPropertiesOverride.mMass = mass!
        }

        const body = this._bodyInterface.CreateBody(creationSettings)
        JOLT.destroy(pos)
        JOLT.destroy(rot)
        JOLT.destroy(creationSettings)

        this._bodyInterface.AddBody(body.GetID(), JOLT.EActivation_Activate)
        body.SetAllowSleeping(false)

        if (friction !== undefined) body.SetFriction(friction)
        if (restitution !== undefined) body.SetRestitution(restitution)

        this._bodies.set(bodyId, {
            id: bodyId,
            joltBody: body,
            joltBodyId: body.GetID(),
        })
    }

    public moveBody(
        bodyId: string,
        position?: Vec3Tuple,
        rotation?: QuatTuple,
        linearVelocity?: Vec3Tuple,
        angularVelocity?: Vec3Tuple,
    ): void {
        const record = this._bodies.get(bodyId)
        if (!record) {
            throw new Error(`Body '${bodyId}' not found`)
        }

        if (position && rotation) {
            this._bodyInterface.SetPositionAndRotation(
                record.joltBodyId,
                new JOLT.RVec3(...position),
                new JOLT.Quat(...rotation),
                JOLT.EActivation_Activate,
            )
        } else if (position) {
            this._bodyInterface.SetPosition(
                record.joltBodyId,
                new JOLT.RVec3(...position),
                JOLT.EActivation_Activate,
            )
        } else if (rotation) {
            this._bodyInterface.SetRotation(
                record.joltBodyId,
                new JOLT.Quat(...rotation),
                JOLT.EActivation_Activate,
            )
        }

        if (linearVelocity) {
            this._bodyInterface.SetLinearVelocity(record.joltBodyId, new JOLT.Vec3(...linearVelocity))
        }
        if (angularVelocity) {
            this._bodyInterface.SetAngularVelocity(record.joltBodyId, new JOLT.Vec3(...angularVelocity))
        }
    }

    public removeBody(bodyId: string): void {
        const record = this._bodies.get(bodyId)
        if (!record) {
            throw new Error(`Body '${bodyId}' not found`)
        }

        const jointsToRemove: string[] = []
        for (const [jointId, joint] of this._joints) {
            // Constraints don't expose body references directly; track removal
            // by checking the joint record at add time instead. For now, the
            // caller is responsible for removing joints before their bodies.
            void joint
            void jointId
        }
        jointsToRemove.forEach(id => this.removeJoint(id))

        this._bodyInterface.RemoveBody(record.joltBodyId)
        this._bodyInterface.DestroyBody(record.joltBodyId)
        this._bodies.delete(bodyId)
    }

    public addJoint(
        jointId: string,
        bodyIdA: string,
        bodyIdB: string,
        jointType: OvenJointType,
        anchor: Vec3Tuple,
        axis?: Vec3Tuple,
        limitsMin?: number,
        limitsMax?: number,
    ): void {
        if (this._joints.has(jointId)) {
            throw new Error(`Joint '${jointId}' already exists`)
        }

        const recordA = this._bodies.get(bodyIdA)
        const recordB = this._bodies.get(bodyIdB)
        if (!recordA || !recordB) {
            throw new Error(`Body '${!recordA ? bodyIdA : bodyIdB}' not found for joint`)
        }

        const anchorPoint = new JOLT.RVec3(...anchor)
        let constraint: Jolt.Constraint

        switch (jointType) {
            case "fixed": {
                const settings = new JOLT.FixedConstraintSettings()
                settings.mPoint1 = settings.mPoint2 = anchorPoint
                constraint = settings.Create(recordA.joltBody, recordB.joltBody)
                break
            }
            case "hinge": {
                const settings = new JOLT.HingeConstraintSettings()
                settings.mPoint1 = settings.mPoint2 = anchorPoint
                const hingeAxis = axis
                    ? new JOLT.Vec3(...axis).Normalized()
                    : new JOLT.Vec3(0, 1, 0)
                settings.mHingeAxis1 = settings.mHingeAxis2 = hingeAxis
                settings.mNormalAxis1 = settings.mNormalAxis2 = getPerpendicular(hingeAxis)
                if (limitsMin !== undefined) settings.mLimitsMin = limitsMin
                if (limitsMax !== undefined) settings.mLimitsMax = limitsMax
                constraint = settings.Create(recordA.joltBody, recordB.joltBody)
                break
            }
            case "slider": {
                const settings = new JOLT.SliderConstraintSettings()
                settings.mPoint1 = settings.mPoint2 = anchorPoint
                const sliderAxis = axis
                    ? new JOLT.Vec3(...axis).Normalized()
                    : new JOLT.Vec3(1, 0, 0)
                settings.mSliderAxis1 = settings.mSliderAxis2 = sliderAxis
                settings.mNormalAxis1 = settings.mNormalAxis2 = getPerpendicular(sliderAxis)
                if (limitsMin !== undefined) settings.mLimitsMin = limitsMin
                if (limitsMax !== undefined) settings.mLimitsMax = limitsMax
                constraint = settings.Create(recordA.joltBody, recordB.joltBody)
                break
            }
            default:
                throw new Error(`Unknown joint type: ${jointType}`)
        }

        this._physicsSystem.AddConstraint(constraint)
        this._joints.set(jointId, { id: jointId, constraint })
    }

    public removeJoint(jointId: string): void {
        const record = this._joints.get(jointId)
        if (!record) {
            throw new Error(`Joint '${jointId}' not found`)
        }

        this._physicsSystem.RemoveConstraint(record.constraint)
        this._joints.delete(jointId)
    }

    public setupRecorder(framerate: number, maxFrameBuffer: number): void {
        const stepsPerFrame = Math.max(1, Math.round(1.0 / (framerate * this._timestep)))
        this._recorder = { framerate, maxFrameBuffer, stepsPerFrame }
    }

    public clearRecorder(): void {
        this._recorder = undefined
    }

    public setRecordingFlushCallback(cb: RecordingFlushCallback | undefined): void {
        this._onRecordingFlush = cb
    }

    public simulate(steps: number): void {
        if (!this._recorder || !this._onRecordingFlush) {
            for (let i = 0; i < steps; i++) {
                this._joltInterface.Step(this._timestep, this._substeps)
            }
            return
        }

        const { stepsPerFrame, maxFrameBuffer } = this._recorder
        const bodyIds = [...this._bodies.keys()]

        let frameBuffer: Map<string, OvenBodyKeyframe[]> = new Map()
        for (const id of bodyIds) {
            frameBuffer.set(id, [])
        }
        let framesInBuffer = 0
        let bufferFirstStep = 0

        const captureFrame = () => {
            for (const [id, record] of this._bodies) {
                const pos = this._bodyInterface.GetPosition(record.joltBodyId)
                const rot = this._bodyInterface.GetRotation(record.joltBodyId)
                const keyframe: OvenBodyKeyframe = {
                    position: [pos.GetX(), pos.GetY(), pos.GetZ()],
                    rotation: [rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()],
                }
                frameBuffer.get(id)!.push(keyframe)
            }
            framesInBuffer++
        }

        const flush = (lastStep: number) => {
            const bodies: OvenRecordingBody[] = bodyIds.map(id => ({
                bodyId: id,
                keyframes: frameBuffer.get(id)!,
            }))
            this._onRecordingFlush!(bodies, bufferFirstStep, lastStep)

            frameBuffer = new Map()
            for (const id of bodyIds) {
                frameBuffer.set(id, [])
            }
            framesInBuffer = 0
            bufferFirstStep = lastStep + 1
        }

        for (let i = 0; i < steps; i++) {
            this._joltInterface.Step(this._timestep, this._substeps)

            if ((i + 1) % stepsPerFrame === 0 || i === steps - 1) {
                captureFrame()

                if (framesInBuffer >= maxFrameBuffer) {
                    flush(i)
                }
            }
        }

        if (framesInBuffer > 0) {
            flush(steps - 1)
        }
    }

    public saveState(slotName?: string): void {
        const slot = slotName ?? DEFAULT_SAVE_SLOT
        const snapshot = new Map<string, BodySnapshot>()

        for (const [id, record] of this._bodies) {
            const pos = this._bodyInterface.GetPosition(record.joltBodyId)
            const rot = this._bodyInterface.GetRotation(record.joltBodyId)
            const linVel = this._bodyInterface.GetLinearVelocity(record.joltBodyId)
            const angVel = this._bodyInterface.GetAngularVelocity(record.joltBodyId)

            snapshot.set(id, {
                position: [pos.GetX(), pos.GetY(), pos.GetZ()],
                rotation: [rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()],
                linearVelocity: [linVel.GetX(), linVel.GetY(), linVel.GetZ()],
                angularVelocity: [angVel.GetX(), angVel.GetY(), angVel.GetZ()],
            })
        }

        this._savedStates.set(slot, snapshot)
    }

    public resetState(slotName?: string): void {
        const slot = slotName ?? DEFAULT_SAVE_SLOT
        const snapshot = this._savedStates.get(slot)
        if (!snapshot) {
            throw new Error(`No saved state in slot '${slot}'`)
        }

        for (const [id, state] of snapshot) {
            const record = this._bodies.get(id)
            if (!record) continue

            this._bodyInterface.SetPositionAndRotation(
                record.joltBodyId,
                new JOLT.RVec3(...state.position),
                new JOLT.Quat(...state.rotation),
                JOLT.EActivation_Activate,
            )
            this._bodyInterface.SetLinearVelocity(record.joltBodyId, new JOLT.Vec3(...state.linearVelocity))
            this._bodyInterface.SetAngularVelocity(record.joltBodyId, new JOLT.Vec3(...state.angularVelocity))
        }
    }

    public getBodyStates(): OvenBodyState[] {
        const states: OvenBodyState[] = []

        for (const [id, record] of this._bodies) {
            const pos = this._bodyInterface.GetPosition(record.joltBodyId)
            const rot = this._bodyInterface.GetRotation(record.joltBodyId)
            const linVel = this._bodyInterface.GetLinearVelocity(record.joltBodyId)
            const angVel = this._bodyInterface.GetAngularVelocity(record.joltBodyId)

            states.push({
                bodyId: id,
                position: [pos.GetX(), pos.GetY(), pos.GetZ()],
                rotation: [rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()],
                linearVelocity: [linVel.GetX(), linVel.GetY(), linVel.GetZ()],
                angularVelocity: [angVel.GetX(), angVel.GetY(), angVel.GetZ()],
            })
        }

        return states
    }

    public destroy(): void {
        for (const [, joint] of this._joints) {
            this._physicsSystem.RemoveConstraint(joint.constraint)
        }
        this._joints.clear()

        for (const [, record] of this._bodies) {
            this._bodyInterface.RemoveBody(record.joltBodyId)
            this._bodyInterface.DestroyBody(record.joltBodyId)
        }
        this._bodies.clear()
        this._savedStates.clear()

        JOLT.destroy(this._joltInterface)
    }

    private setupCollisionFiltering(settings: Jolt.JoltSettings): void {
        const objectFilter = new JOLT.ObjectLayerPairFilterTable(COUNT_OBJECT_LAYERS)
        objectFilter.EnableCollision(LAYER_STATIC, LAYER_DYNAMIC)
        objectFilter.EnableCollision(LAYER_DYNAMIC, LAYER_DYNAMIC)

        const BP_STATIC = new JOLT.BroadPhaseLayer(LAYER_STATIC)
        const BP_DYNAMIC = new JOLT.BroadPhaseLayer(LAYER_DYNAMIC)

        const bpInterface = new JOLT.BroadPhaseLayerInterfaceTable(COUNT_OBJECT_LAYERS, COUNT_OBJECT_LAYERS)
        bpInterface.MapObjectToBroadPhaseLayer(LAYER_STATIC, BP_STATIC)
        bpInterface.MapObjectToBroadPhaseLayer(LAYER_DYNAMIC, BP_DYNAMIC)

        settings.mObjectLayerPairFilter = objectFilter
        settings.mBroadPhaseLayerInterface = bpInterface
        settings.mObjectVsBroadPhaseLayerFilter = new JOLT.ObjectVsBroadPhaseLayerFilterTable(
            settings.mBroadPhaseLayerInterface,
            COUNT_OBJECT_LAYERS,
            settings.mObjectLayerPairFilter,
            COUNT_OBJECT_LAYERS,
        )
    }
}

function getPerpendicular(vec: Jolt.Vec3): Jolt.Vec3 {
    return tryGetPerpendicular(vec, new JOLT.Vec3(0, 1, 0))
        ?? tryGetPerpendicular(vec, new JOLT.Vec3(0, 0, 1))!
}

function tryGetPerpendicular(vec: Jolt.Vec3, toCheck: Jolt.Vec3): Jolt.Vec3 | undefined {
    if (Math.abs(Math.abs(vec.Dot(toCheck)) - 1.0) < 0.0001) return undefined

    const a = vec.Dot(toCheck)
    return new JOLT.Vec3(
        toCheck.GetX() - vec.GetX() * a,
        toCheck.GetY() - vec.GetY() * a,
        toCheck.GetZ() - vec.GetZ() * a,
    ).Normalized()
}

export default OvenSystem
