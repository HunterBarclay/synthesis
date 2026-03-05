import JOLT from "@/util/loading/JoltSyncLoader"
import Jolt from "@azaleacolburn/jolt-physics"

const DEFAULT_TIMESTEP = 1.0 / 240.0
const DEFAULT_SUBSTEP = 3

class OvenSystem {
    private _joltInterface: Jolt.JoltInterface
    private _physicsSystem: Jolt.PhysicsSystem
    private _bodyInterface: Jolt.BodyInterface

    private _timestep: number = DEFAULT_TIMESTEP
    private _substeps: number = DEFAULT_SUBSTEP

    private _bodies: Jolt.BodyID[]

    public get timestep(): number { return this._timestep }
    public set timestep(pTimestep: number) { this._timestep = pTimestep }
    public get substep(): number { return this._substeps }
    public set substep(pSubstep: number) { this._substeps = pSubstep }

    constructor() {
        this._bodies = []
        // this._constraints = []

        const joltSettings = new JOLT.JoltSettings()

        this._joltInterface = new JOLT.JoltInterface(joltSettings)
        JOLT.destroy(joltSettings)

        this._physicsSystem = this._joltInterface.GetPhysicsSystem()
        this._bodyInterface = this._physicsSystem.GetBodyInterface()

        this._physicsSystem.SetGravity(new JOLT.Vec3(0, -9.8, 0))
        this._physicsSystem.GetPhysicsSettings().mDeterministicSimulation = true
        this._physicsSystem.GetPhysicsSettings().mSpeculativeContactDistance = 0.06
        this._physicsSystem.GetPhysicsSettings().mPenetrationSlop = 0.005
    }

    public step() {
        this._joltInterface.Step(this._timestep, this._substeps)
    }

    public createStaticBox(pPosition: [number, number, number], pHalfExtents: [number, number, number], pIsStatic: boolean) {
        const position = new JOLT.RVec3(pPosition[0], pPosition[1], pPosition[2])
        const halfExtents = new JOLT.Vec3(pHalfExtents[0], pHalfExtents[1], pHalfExtents[2])
        const shape = new JOLT.BoxShape(halfExtents)
        JOLT.destroy(halfExtents)

        const rot = new JOLT.Quat(0, 0, 0, 1)
        const creationSettings = new JOLT.BodyCreationSettings(
            shape,
            position,
            rot,
            JOLT.EMotionType_Dynamic,
            LAYER_GHOST
        )
        creationSettings.mOverrideMassProperties = JOLT.EOverrideMassProperties_CalculateInertia
        creationSettings.mMassPropertiesOverride.mMass = 0.01

        const body = this._joltBodyInterface.CreateBody(creationSettings)
        JOLT.destroy(rot)
        JOLT.destroy(creationSettings)

        this._bodies.push(body.GetID())
    }
}

export default OvenSystem;
