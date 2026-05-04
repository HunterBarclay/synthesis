import JOLT from "@/util/loading/JoltSyncLoader"
import type Jolt from "@azaleacolburn/jolt-physics"
import type {
    Vec3Tuple,
    QuatTuple,
    OvenBodyState,
    OvenBodyKeyframe,
    OvenRecordingBody,
    OvenJointType,
    OvenTray,
    OvenTrayAssembly,
    OvenJointMotor,
    OvenNodeOverride,
} from "./OvenProtocol"
import { mirabuf } from "@/proto/mirabuf"
import MirabufParser from "@/mirabuf/MirabufParser"
import MirabufPhysicsHandler, { type CreatedBody } from "@/mirabuf/MirabufPhysicsHandler"

const DEFAULT_TIMESTEP = 1.0 / 240.0
const DEFAULT_SUBSTEPS = 3
const DEFAULT_GRAVITY: Vec3Tuple = [0, -9.8, 0]

const LAYER_STATIC = 0
const LAYER_DYNAMIC = 1
const ASSEMBLY_LAYERS: number[] = [2, 3, 4, 5, 6, 7, 8, 9]
const MAX_ASSEMBLIES = ASSEMBLY_LAYERS.length
const COUNT_OBJECT_LAYERS = 2 + MAX_ASSEMBLIES

interface BodyRecord {
    id: string
    joltBody: Jolt.Body
    joltBodyId: Jolt.BodyID
}

type ConstraintKind = "hinge" | "slider" | "fixed"

interface JointRecord {
    id: string
    constraint: Jolt.Constraint
    kind: ConstraintKind
}

interface ActiveMotor {
    jointId: string
    record: JointRecord
    mode: "velocity" | "position"
    targetValue: number
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

export type ProgressCallback = (
    completedSteps: number,
    totalSteps: number,
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
    private _activeMotors: ActiveMotor[] = []
    private _savedStates: Map<string, Map<string, BodySnapshot>> = new Map()

    private _recorder: RecorderConfig | undefined
    private _onRecordingFlush: RecordingFlushCallback | undefined

    private _progressInterval: number = 0
    private _onProgress: ProgressCallback | undefined

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

    public configure(gravity?: Vec3Tuple, timestep?: number, substeps?: number, progressInterval?: number): void {
        if (gravity) {
            this._physicsSystem.SetGravity(new JOLT.Vec3(...gravity))
        }
        if (timestep !== undefined) {
            this._timestep = timestep
        }
        if (substeps !== undefined) {
            this._substeps = substeps
        }
        if (progressInterval !== undefined) {
            this._progressInterval = progressInterval
        }
    }

    public loadTray(tray: OvenTray): void {
        this.clearScene()

        for (const body of tray.bodies) {
            this.addBody(
                body.bodyId,
                body.halfExtents,
                body.position,
                body.rotation,
                body.mass,
                body.fixed,
                body.friction,
                body.restitution,
            )
        }

        for (const joint of tray.joints) {
            this.addJoint(
                joint.jointId,
                joint.bodyIdA,
                joint.bodyIdB,
                joint.jointType,
                joint.anchor,
                joint.axis,
                joint.limitsMin,
                joint.limitsMax,
            )
        }

        if (tray.assemblies) {
            for (let i = 0; i < tray.assemblies.length; i++) {
                this.loadAssembly(tray.assemblies[i], i)
            }
        }
    }

    private loadAssembly(asm: OvenTrayAssembly, index: number): void {
        if (index >= MAX_ASSEMBLIES) {
            console.error(`[Oven] Maximum assembly count (${MAX_ASSEMBLIES}) exceeded`)
            return
        }

        const assembly = mirabuf.Assembly.decode(asm.assemblyData)
        const parser = new MirabufParser(assembly)
        const handler = new MirabufPhysicsHandler(this._bodyInterface, this._physicsSystem)

        const asmLayer = ASSEMBLY_LAYERS[index]
        const bodyResult = handler.createBodiesFromParser(parser, {
            layerResolver: () => asmLayer,
        })

        const prefix = `_asm${index}_`
        for (const created of bodyResult.createdBodies) {
            this._bodies.set(prefix + created.nodeId, {
                id: prefix + created.nodeId,
                joltBody: created.body,
                joltBodyId: created.bodyId,
            })
        }

        if (asm.nodeOverrides) {
            this.applyNodeOverrides(asm.nodeOverrides, bodyResult.createdBodies)
        }

        if (asm.position || asm.rotation) {
            this.applyAssemblyTransform(bodyResult.createdBodies, asm.position, asm.rotation)
        }

        const jointWorldTransform = (asm.position || asm.rotation)
            ? {
                position: asm.position ?? [0, 0, 0] as [number, number, number],
                rotation: asm.rotation ?? [0, 0, 0, 1] as [number, number, number, number],
            }
            : undefined

        const jointResult = handler.createJointsFromParser(parser, bodyResult.nodeToBodyId, jointWorldTransform)

        const motorLookup = new Map<string, OvenJointMotor>()
        if (asm.motors) {
            for (const motor of asm.motors) {
                motorLookup.set(motor.jointGuid, motor)
            }
        }

        for (const created of jointResult.createdJoints) {
            const kind: ConstraintKind =
                created.motionType === mirabuf.joint.JointMotion.REVOLUTE ? "hinge"
                : created.motionType === mirabuf.joint.JointMotion.SLIDER ? "slider"
                : "fixed"

            const jointId = `_asm${index}_${created.jointGuid}`
            const record: JointRecord = { id: jointId, constraint: created.constraint, kind }
            this._joints.set(jointId, record)

            const motorDef = motorLookup.get(created.jointGuid)
            if (motorDef) {
                this.applyMotor(record, motorDef)
            }
        }
    }

    private applyMotor(record: JointRecord, motor: OvenJointMotor): void {
        if (record.kind === "hinge") {
            const hinge = JOLT.castObject(record.constraint, JOLT.HingeConstraint)
            const motorSettings = hinge.GetMotorSettings()

            if (motor.maxTorque !== undefined) {
                motorSettings.mMaxTorqueLimit = motor.maxTorque
                motorSettings.mMinTorqueLimit = -motor.maxTorque
            }

            if (motor.mode === "velocity") {
                hinge.SetMotorState(JOLT.EMotorState_Velocity)
                hinge.SetTargetAngularVelocity(motor.targetValue)
            } else {
                hinge.SetMotorState(JOLT.EMotorState_Position)
                hinge.SetTargetAngle(motor.targetValue)
            }

            this._activeMotors.push({
                jointId: record.id,
                record,
                mode: motor.mode,
                targetValue: motor.targetValue,
            })
        } else if (record.kind === "slider") {
            const slider = JOLT.castObject(record.constraint, JOLT.SliderConstraint)
            const motorSettings = slider.GetMotorSettings()

            if (motor.maxForce !== undefined) {
                motorSettings.mMaxForceLimit = motor.maxForce
                motorSettings.mMinForceLimit = -motor.maxForce
            }

            if (motor.mode === "velocity") {
                slider.SetMotorState(JOLT.EMotorState_Velocity)
                slider.SetTargetVelocity(motor.targetValue)
            } else {
                slider.SetMotorState(JOLT.EMotorState_Position)
                slider.SetTargetPosition(motor.targetValue)
            }

            this._activeMotors.push({
                jointId: record.id,
                record,
                mode: motor.mode,
                targetValue: motor.targetValue,
            })
        }
    }

    private applyNodeOverrides(
        overrides: Record<string, OvenNodeOverride>,
        createdBodies: CreatedBody[],
    ): void {
        for (const created of createdBodies) {
            const override = overrides[created.nodeId]
            if (!override) continue

            if (override.fixed) {
                this._bodyInterface.SetMotionType(
                    created.bodyId,
                    JOLT.EMotionType_Static,
                    JOLT.EActivation_DontActivate,
                )
            }
        }
    }

    private applyAssemblyTransform(
        createdBodies: CreatedBody[],
        position?: Vec3Tuple,
        rotation?: QuatTuple,
    ): void {
        const asmPos = position ?? [0, 0, 0]
        const asmRot = rotation ?? [0, 0, 0, 1]
        const asmQuat = new JOLT.Quat(asmRot[0], asmRot[1], asmRot[2], asmRot[3])

        for (const created of createdBodies) {
            const curPos = this._bodyInterface.GetPosition(created.bodyId)
            const curRot = this._bodyInterface.GetRotation(created.bodyId)

            const rotated = asmQuat.MulVec3(new JOLT.Vec3(curPos.GetX(), curPos.GetY(), curPos.GetZ()))
            const newPos = new JOLT.RVec3(
                rotated.GetX() + asmPos[0],
                rotated.GetY() + asmPos[1],
                rotated.GetZ() + asmPos[2],
            )
            const newRot = asmQuat.MulQuat(curRot)

            this._bodyInterface.SetPositionAndRotation(
                created.bodyId,
                newPos,
                newRot,
                JOLT.EActivation_Activate,
            )
        }
    }

    private clearScene(): void {
        this._activeMotors = []

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
    }

    private addBody(
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

    private addJoint(
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

        let kind: ConstraintKind

        switch (jointType) {
            case "fixed": {
                const settings = new JOLT.FixedConstraintSettings()
                settings.mPoint1 = settings.mPoint2 = anchorPoint
                constraint = settings.Create(recordA.joltBody, recordB.joltBody)
                kind = "fixed"
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
                kind = "hinge"
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
                kind = "slider"
                break
            }
            default:
                throw new Error(`Unknown joint type: ${jointType}`)
        }

        this._physicsSystem.AddConstraint(constraint)
        this._joints.set(jointId, { id: jointId, constraint, kind })
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

    public setProgressCallback(cb: ProgressCallback | undefined): void {
        this._onProgress = cb
    }

    public simulate(steps: number): void {
        const shouldReportProgress = this._progressInterval > 0 && this._onProgress
        let nextProgressAt = shouldReportProgress ? this._progressInterval : steps + 1

        if (!this._recorder || !this._onRecordingFlush) {
            for (let i = 0; i < steps; i++) {
                this._joltInterface.Step(this._timestep, this._substeps)

                if (i + 1 >= nextProgressAt) {
                    this._onProgress!(i + 1, steps)
                    nextProgressAt += this._progressInterval
                }
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

            if (i + 1 >= nextProgressAt) {
                this._onProgress!(i + 1, steps)
                nextProgressAt += this._progressInterval
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
        this.clearScene()
        JOLT.destroy(this._joltInterface)
    }

    private setupCollisionFiltering(settings: Jolt.JoltSettings): void {
        const objectFilter = new JOLT.ObjectLayerPairFilterTable(COUNT_OBJECT_LAYERS)
        objectFilter.EnableCollision(LAYER_STATIC, LAYER_DYNAMIC)
        objectFilter.EnableCollision(LAYER_DYNAMIC, LAYER_DYNAMIC)

        for (const asmLayer of ASSEMBLY_LAYERS) {
            objectFilter.EnableCollision(LAYER_STATIC, asmLayer)
            objectFilter.EnableCollision(LAYER_DYNAMIC, asmLayer)
        }

        for (let i = 0; i < ASSEMBLY_LAYERS.length - 1; i++) {
            for (let j = i + 1; j < ASSEMBLY_LAYERS.length; j++) {
                objectFilter.EnableCollision(ASSEMBLY_LAYERS[i], ASSEMBLY_LAYERS[j])
            }
        }

        const BP_STATIC = new JOLT.BroadPhaseLayer(LAYER_STATIC)
        const BP_DYNAMIC = new JOLT.BroadPhaseLayer(LAYER_DYNAMIC)
        const bpAssemblyLayers = ASSEMBLY_LAYERS.map(l => new JOLT.BroadPhaseLayer(l))

        const bpInterface = new JOLT.BroadPhaseLayerInterfaceTable(COUNT_OBJECT_LAYERS, COUNT_OBJECT_LAYERS)
        bpInterface.MapObjectToBroadPhaseLayer(LAYER_STATIC, BP_STATIC)
        bpInterface.MapObjectToBroadPhaseLayer(LAYER_DYNAMIC, BP_DYNAMIC)
        bpAssemblyLayers.forEach((bp, i) => {
            bpInterface.MapObjectToBroadPhaseLayer(ASSEMBLY_LAYERS[i], bp)
        })

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
