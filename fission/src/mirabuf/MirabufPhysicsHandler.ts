import JOLT from "@/util/loading/JoltSyncLoader"
import type Jolt from "@azaleacolburn/jolt-physics"
import type MirabufParser from "./MirabufParser"
import { GAMEPIECE_SUFFIX, GROUNDED_JOINT_ID, type RigidNodeReadOnly } from "./MirabufParser"
import { mirabuf } from "@/proto/mirabuf"
import {
    convertMirabufFloatToArrJoltFloat3,
    convertMirabufFloatToArrJoltVec3,
    convertMirabufVector3ToJoltRVec3,
    convertThreeMatrix4ToJoltMat44,
} from "@/util/TypeConversions"

const DEFAULT_FRICTION = 0.7
const SIGNIFICANT_FRICTION_THRESHOLD = 0.05
const DEFAULT_PHYSICAL_MATERIAL_KEY = "default"

export type LayerResolver = (node: RigidNodeReadOnly) => number

export interface BodyCreationOptions {
    layerResolver: LayerResolver
    massCap?: number
    maxGamePieceMass?: number
    defaultRestitution?: number
}

export interface CreatedBody {
    nodeId: string
    body: Jolt.Body
    bodyId: Jolt.BodyID
}

export interface BodyCreationResult {
    createdBodies: CreatedBody[]
    nodeToBodyId: Map<string, Jolt.BodyID>
}

export interface CreatedJoint {
    jointGuid: string
    constraint: Jolt.Constraint
    motionType: number
}

export interface JointCreationResult {
    constraints: Jolt.Constraint[]
    createdJoints: CreatedJoint[]
}

class MirabufPhysicsHandler {
    private _bodyInterface: Jolt.BodyInterface
    private _physicsSystem: Jolt.PhysicsSystem

    constructor(bodyInterface: Jolt.BodyInterface, physicsSystem: Jolt.PhysicsSystem) {
        this._bodyInterface = bodyInterface
        this._physicsSystem = physicsSystem
    }

    public createBodiesFromParser(parser: MirabufParser, options: BodyCreationOptions): BodyCreationResult {
        const nodeToBodyId = new Map<string, Jolt.BodyID>()
        const createdBodies: CreatedBody[] = []

        const nonPhysicsNodes = filterNonPhysicsNodes([...parser.rigidNodes.values()], parser.assembly)

        const massMod = (() => {
            if (!options.massCap || !parser.assembly.dynamic) return 1
            let assemblyMass = 0
            nonPhysicsNodes.forEach(x => { assemblyMass += x.mass })
            return assemblyMass > options.massCap ? options.massCap / assemblyMass : 1
        })()

        nonPhysicsNodes.forEach(rn => {
            const compoundShapeSettings = new JOLT.StaticCompoundShapeSettings()
            let shapesAdded = 0
            let totalMass = 0

            type FrictionPairing = { dynamic: number; static: number; weight: number }
            const frictionAccum: FrictionPairing[] = []

            const minBounds = new JOLT.Vec3(1000000.0, 1000000.0, 1000000.0)
            const maxBounds = new JOLT.Vec3(-1000000.0, -1000000.0, -1000000.0)

            const rnLayer = options.layerResolver(rn)

            rn.parts.forEach(partId => {
                const partInstance = parser.assembly.data!.parts!.partInstances![partId]!
                if (partInstance.skipCollider) return

                const partDefinition =
                    parser.assembly.data!.parts!.partDefinitions![partInstance.partDefinitionReference!]!

                const debugLabel = {
                    rn: rn.id,
                    partId,
                    defRef: partInstance.partDefinitionReference,
                    name: partDefinition.info?.name ?? partInstance.info?.name ?? "(unnamed)",
                }

                const partShapeResult = rn.isDynamic
                    ? createConvexShapeSettingsFromPart(partDefinition)
                    : createConcaveShapeSettingsFromPart(partDefinition, debugLabel)

                if (!partShapeResult) {
                    console.warn("Skipping collider (no valid shape settings)", debugLabel)
                    return
                }

                const [shapeSettings, partMin, partMax] = partShapeResult

                const transform = convertThreeMatrix4ToJoltMat44(parser.globalTransforms.get(partId)!)
                const translation = transform.GetTranslation()
                const rotation = transform.GetQuaternion()
                compoundShapeSettings.AddShape(translation, rotation, shapeSettings, 0)
                shapesAdded++

                updateMinMaxBounds(transform.Multiply3x3(partMin), minBounds, maxBounds)
                updateMinMaxBounds(transform.Multiply3x3(partMax), minBounds, maxBounds)

                JOLT.destroy(partMin)
                JOLT.destroy(partMax)
                JOLT.destroy(transform)

                const physicalMaterial =
                    parser.assembly.data!.materials!.physicalMaterials![
                        partInstance.physicalMaterial ?? DEFAULT_PHYSICAL_MATERIAL_KEY
                    ]

                if (physicalMaterial) {
                    let frictionOverride: number | undefined =
                        partDefinition?.frictionOverride == null ? undefined : partDefinition?.frictionOverride
                    if ((partDefinition?.frictionOverride ?? 0.0) < SIGNIFICANT_FRICTION_THRESHOLD) {
                        frictionOverride = undefined
                    }

                    if (
                        (physicalMaterial.dynamicFriction ?? 0.0) < SIGNIFICANT_FRICTION_THRESHOLD ||
                        (physicalMaterial.staticFriction ?? 0.0) < SIGNIFICANT_FRICTION_THRESHOLD
                    ) {
                        physicalMaterial.dynamicFriction = DEFAULT_FRICTION
                        physicalMaterial.staticFriction = DEFAULT_FRICTION
                    }

                    frictionAccum.push({
                        dynamic: frictionOverride ?? physicalMaterial.dynamicFriction!,
                        static: frictionOverride ?? physicalMaterial.staticFriction!,
                        weight: partDefinition.physicalData?.area ?? 1.0,
                    })
                } else {
                    frictionAccum.push({
                        dynamic: DEFAULT_FRICTION,
                        static: DEFAULT_FRICTION,
                        weight: partDefinition.physicalData?.area ?? 1.0,
                    })
                }

                if (!partDefinition.physicalData?.com || !partDefinition.physicalData.mass) return

                const mass = partDefinition.massOverride
                    ? partDefinition.massOverride!
                    : partDefinition.physicalData.mass!

                totalMass += mass
            })

            if (shapesAdded > 0) {
                const shapeResult = compoundShapeSettings.Create()

                if (!shapeResult.IsValid || shapeResult.HasError()) {
                    console.error(`Failed to create shape for RigidNode ${rn.id}\n${shapeResult.GetError().c_str()}`)
                    JOLT.destroy(compoundShapeSettings)
                    return
                }

                const shape = shapeResult.Get()

                if (rn.isDynamic) {
                    if (rn.isGamePiece && options.maxGamePieceMass) {
                        shape.GetMassProperties().mMass = totalMass === 0 ? 1 : Math.min(totalMass, options.maxGamePieceMass)
                    } else {
                        shape.GetMassProperties().mMass = totalMass === 0 ? 1 : totalMass * massMod
                    }
                }

                const bodySettings = new JOLT.BodyCreationSettings(
                    shape,
                    new JOLT.RVec3(0.0, 0.0, 0.0),
                    new JOLT.Quat(0, 0, 0, 1),
                    rn.isDynamic ? JOLT.EMotionType_Dynamic : JOLT.EMotionType_Static,
                    rnLayer,
                )
                const body = this._bodyInterface.CreateBody(bodySettings)
                this._bodyInterface.AddBody(body.GetID(), JOLT.EActivation_Activate)
                body.SetAllowSleeping(false)
                nodeToBodyId.set(rn.id, body.GetID())

                let staticFriction = 0.0
                let dynamicFriction = 0.0
                let weightSum = 0.0
                frictionAccum.forEach(pairing => {
                    staticFriction += pairing.static * pairing.weight
                    dynamicFriction += pairing.dynamic * pairing.weight
                    weightSum += pairing.weight
                })
                staticFriction /= weightSum === 0.0 ? 1.0 : weightSum
                dynamicFriction /= weightSum === 0.0 ? 1.0 : weightSum

                body.SetFriction((staticFriction + dynamicFriction) / 2.0)

                if (options.defaultRestitution !== undefined) {
                    body.SetRestitution(options.defaultRestitution)
                }

                createdBodies.push({ nodeId: rn.id, body, bodyId: body.GetID() })
            }

            JOLT.destroy(compoundShapeSettings)
        })

        return { createdBodies, nodeToBodyId }
    }

    public createJointsFromParser(
        parser: MirabufParser,
        nodeToBodyId: Map<string, Jolt.BodyID>,
        worldTransform?: { position: [number, number, number]; rotation: [number, number, number, number] },
    ): JointCreationResult {
        const constraints: Jolt.Constraint[] = []
        const createdJoints: CreatedJoint[] = []
        const jointData = parser.assembly.data!.joints!
        const joints = Object.entries(jointData.jointInstances!) as [string, mirabuf.joint.JointInstance][]

        const wPos = worldTransform?.position
        const wQuat = worldTransform
            ? new JOLT.Quat(worldTransform.rotation[0], worldTransform.rotation[1], worldTransform.rotation[2], worldTransform.rotation[3])
            : undefined

        joints.forEach(([jointGuid, jointInst]) => {
            if (jointGuid === GROUNDED_JOINT_ID) return

            const rnA = parser.partToNodeMap.get(jointInst.parentPart!)
            const rnB = parser.partToNodeMap.get(jointInst.childPart!)

            if (!rnA || !rnB || rnA.id === rnB.id) return

            const bodyIdA = nodeToBodyId.get(rnA.id)
            const bodyIdB = nodeToBodyId.get(rnB.id)
            if (!bodyIdA || !bodyIdB) return

            const bodyA = this._physicsSystem.GetBodyLockInterface().TryGetBody(bodyIdA)
            const bodyB = this._physicsSystem.GetBodyLockInterface().TryGetBody(bodyIdB)
            if (!bodyA || !bodyB) return

            const jDef = jointData.jointDefinitions![jointInst.jointReference!]! as mirabuf.joint.Joint
            const motionType = jDef.jointMotionType!

            let constraint: Jolt.Constraint | undefined

            switch (motionType) {
                case mirabuf.joint.JointMotion.REVOLUTE:
                    constraint = this.createBasicHingeConstraint(jointInst, jDef, bodyA, bodyB, wPos, wQuat)
                    break
                case mirabuf.joint.JointMotion.SLIDER:
                    constraint = this.createBasicSliderConstraint(jointInst, jDef, bodyA, bodyB, wPos, wQuat)
                    break
                default:
                    break
            }

            if (constraint) {
                this._physicsSystem.AddConstraint(constraint)
                constraints.push(constraint)
                createdJoints.push({ jointGuid, constraint, motionType })
            }
        })

        return { constraints, createdJoints }
    }

    private createBasicHingeConstraint(
        jointInstance: mirabuf.joint.JointInstance,
        jointDefinition: mirabuf.joint.Joint,
        bodyA: Jolt.Body,
        bodyB: Jolt.Body,
        wPos?: [number, number, number],
        wQuat?: Jolt.Quat,
    ): Jolt.Constraint {
        const settings = new JOLT.HingeConstraintSettings()

        const jointOrigin = jointDefinition.origin
            ? convertMirabufVector3ToJoltRVec3(jointDefinition.origin as mirabuf.Vector3)
            : new JOLT.RVec3(0, 0, 0)
        const jointOriginOffset = jointInstance.offset
            ? convertMirabufVector3ToJoltRVec3(jointInstance.offset as mirabuf.Vector3)
            : new JOLT.RVec3(0, 0, 0)

        let anchorPoint = jointOrigin.AddRVec3(jointOriginOffset)

        const rotationalFreedom = jointDefinition.rotational!.rotationalFreedom!
        const miraAxis = rotationalFreedom.axis! as mirabuf.Vector3
        let axis = new JOLT.Vec3(miraAxis.x ?? 0, miraAxis.y ?? 0, miraAxis.z ?? 0)

        if (wQuat) {
            const anchorVec = new JOLT.Vec3(anchorPoint.GetX(), anchorPoint.GetY(), anchorPoint.GetZ())
            const rotatedAnchor = wQuat.MulVec3(anchorVec)
            anchorPoint = new JOLT.RVec3(
                rotatedAnchor.GetX() + (wPos?.[0] ?? 0),
                rotatedAnchor.GetY() + (wPos?.[1] ?? 0),
                rotatedAnchor.GetZ() + (wPos?.[2] ?? 0),
            )
            axis = wQuat.MulVec3(axis)
        } else if (wPos) {
            anchorPoint = new JOLT.RVec3(
                anchorPoint.GetX() + wPos[0],
                anchorPoint.GetY() + wPos[1],
                anchorPoint.GetZ() + wPos[2],
            )
        }

        settings.mPoint1 = settings.mPoint2 = anchorPoint

        settings.mHingeAxis1 = settings.mHingeAxis2 = axis.Normalized()
        settings.mNormalAxis1 = settings.mNormalAxis2 = getPerpendicular(settings.mHingeAxis1)

        const piSafetyCheck = (v: number) => Math.min(3.14158, Math.max(-3.14158, v))
        if (
            rotationalFreedom.limits &&
            Math.abs((rotationalFreedom.limits.upper ?? 0) - (rotationalFreedom.limits.lower ?? 0)) > 0.001
        ) {
            const currentPos = piSafetyCheck(rotationalFreedom.value ?? 0)
            const upper = piSafetyCheck(rotationalFreedom.limits.upper ?? 0) - currentPos
            const lower = piSafetyCheck(rotationalFreedom.limits.lower ?? 0) - currentPos
            settings.mLimitsMin = -upper
            settings.mLimitsMax = -lower
        }

        return settings.Create(bodyA, bodyB)
    }

    private createBasicSliderConstraint(
        jointInstance: mirabuf.joint.JointInstance,
        jointDefinition: mirabuf.joint.Joint,
        bodyA: Jolt.Body,
        bodyB: Jolt.Body,
        wPos?: [number, number, number],
        wQuat?: Jolt.Quat,
    ): Jolt.Constraint {
        const settings = new JOLT.SliderConstraintSettings()

        const jointOrigin = jointDefinition.origin
            ? convertMirabufVector3ToJoltRVec3(jointDefinition.origin as mirabuf.Vector3)
            : new JOLT.RVec3(0, 0, 0)
        const jointOriginOffset = jointInstance.offset
            ? convertMirabufVector3ToJoltRVec3(jointInstance.offset as mirabuf.Vector3)
            : new JOLT.RVec3(0, 0, 0)

        let anchorPoint = jointOrigin.AddRVec3(jointOriginOffset)

        const prismaticFreedom = jointDefinition.prismatic!.prismaticFreedom!
        const miraAxis = prismaticFreedom.axis! as mirabuf.Vector3
        let axis = new JOLT.Vec3(miraAxis.x ?? 0, miraAxis.y ?? 0, miraAxis.z ?? 0)

        if (wQuat) {
            const anchorVec = new JOLT.Vec3(anchorPoint.GetX(), anchorPoint.GetY(), anchorPoint.GetZ())
            const rotatedAnchor = wQuat.MulVec3(anchorVec)
            anchorPoint = new JOLT.RVec3(
                rotatedAnchor.GetX() + (wPos?.[0] ?? 0),
                rotatedAnchor.GetY() + (wPos?.[1] ?? 0),
                rotatedAnchor.GetZ() + (wPos?.[2] ?? 0),
            )
            axis = wQuat.MulVec3(axis)
        } else if (wPos) {
            anchorPoint = new JOLT.RVec3(
                anchorPoint.GetX() + wPos[0],
                anchorPoint.GetY() + wPos[1],
                anchorPoint.GetZ() + wPos[2],
            )
        }

        settings.mPoint1 = settings.mPoint2 = anchorPoint

        settings.mSliderAxis1 = settings.mSliderAxis2 = axis.Normalized()
        settings.mNormalAxis1 = settings.mNormalAxis2 = getPerpendicular(settings.mSliderAxis1)

        if (
            prismaticFreedom.limits &&
            Math.abs((prismaticFreedom.limits.upper ?? 0) - (prismaticFreedom.limits.lower ?? 0)) > 0.001
        ) {
            const currentPos = (prismaticFreedom.value ?? 0) * 0.01
            const upper = (prismaticFreedom.limits.upper ?? 0) * 0.01 - currentPos
            const lower = (prismaticFreedom.limits.lower ?? 0) * 0.01 - currentPos

            const midPoint = (upper + lower) / 2.0
            const halfRange = Math.abs((upper - lower) / 2.0)

            settings.mPoint2 = anchorPoint.Add(axis.Normalized().Mul(midPoint))
            settings.mLimitsMax = halfRange
            settings.mLimitsMin = -halfRange
        }

        return settings.Create(bodyA, bodyB)
    }
}

export function createConvexShapeSettingsFromPart(
    partDefinition: mirabuf.IPartDefinition,
): [Jolt.ShapeSettings, Jolt.Vec3, Jolt.Vec3] | undefined {
    const settings = new JOLT.ConvexHullShapeSettings()

    const min = new JOLT.Vec3(1000000.0, 1000000.0, 1000000.0)
    const max = new JOLT.Vec3(-1000000.0, -1000000.0, -1000000.0)

    const points = settings.mPoints
    partDefinition.bodies!.forEach(body => {
        const verts = body.triangleMesh?.mesh?.verts
        if (!verts) return

        for (let i = 0; i < verts.length; i += 3) {
            const vert = convertMirabufFloatToArrJoltVec3(verts, i)
            points.push_back(vert)
            updateMinMaxBounds(vert, min, max)
            JOLT.destroy(vert)
        }
    })

    if (points.size() < 4) {
        JOLT.destroy(settings)
        JOLT.destroy(min)
        JOLT.destroy(max)
        return
    }

    return [settings, min, max]
}

export function createConcaveShapeSettingsFromPart(
    partDefinition: mirabuf.IPartDefinition,
    debugLabel?: Record<string, unknown>,
): [Jolt.ShapeSettings, Jolt.Vec3, Jolt.Vec3] | undefined {
    const settings = new JOLT.MeshShapeSettings()

    settings.mMaxTrianglesPerLeaf = 4
    settings.mTriangleVertices = new JOLT.VertexList()
    settings.mIndexedTriangles = new JOLT.IndexedTriangleList()
    settings.mMaterials = new JOLT.PhysicsMaterialList()
    settings.mMaterials.push_back(new JOLT.PhysicsMaterial())

    const min = new JOLT.Vec3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
    const max = new JOLT.Vec3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

    let maxIndex = -1
    partDefinition.bodies!.forEach(body => {
        const vertArr = body.triangleMesh?.mesh?.verts
        const indexArr = body.triangleMesh?.mesh?.indices
        if (!vertArr || !indexArr) return
        if (indexArr.length < 3 || indexArr.length % 3 !== 0) return

        for (let i = 0; i < vertArr.length; i += 3) {
            const vert = convertMirabufFloatToArrJoltFloat3(vertArr, i)
            settings.mTriangleVertices.push_back(vert)
            updateMinMaxBounds(new JOLT.Vec3(vert), min, max)
            JOLT.destroy(vert)
        }

        for (let i = 0; i < indexArr.length; i += 3) {
            const a = indexArr.at(i)!
            const b = indexArr.at(i + 1)!
            const c = indexArr.at(i + 2)!
            if (a > maxIndex) maxIndex = a
            if (b > maxIndex) maxIndex = b
            if (c > maxIndex) maxIndex = c
            settings.mIndexedTriangles.push_back(new JOLT.IndexedTriangle(a, b, c, 0))
        }
    })

    const vertCount = settings.mTriangleVertices.size()
    const triCountBeforeSanitize = settings.mIndexedTriangles.size()

    if (vertCount < 3 || triCountBeforeSanitize === 0 || maxIndex >= vertCount) {
        if (debugLabel) {
            console.warn("Concave collider invalid (no triangles or bad indices)", {
                ...debugLabel,
                vertCount,
                triCount: triCountBeforeSanitize,
                maxIndex,
            })
        }
        JOLT.destroy(settings)
        JOLT.destroy(min)
        JOLT.destroy(max)
        return
    }

    settings.Sanitize()
    const triCount = settings.mIndexedTriangles.size()
    if (triCount === 0) {
        if (debugLabel) {
            console.warn("Concave collider sanitized to zero triangles (degenerate)", {
                ...debugLabel,
                vertCount,
                triCountBeforeSanitize,
            })
        }
        JOLT.destroy(settings)
        JOLT.destroy(min)
        JOLT.destroy(max)
        return
    }

    return [settings, min, max]
}

export function updateMinMaxBounds(v: Jolt.Vec3, min: Jolt.Vec3, max: Jolt.Vec3): void {
    if (v.GetX() < min.GetX()) min.SetX(v.GetX())
    if (v.GetY() < min.GetY()) min.SetY(v.GetY())
    if (v.GetZ() < min.GetZ()) min.SetZ(v.GetZ())
    if (v.GetX() > max.GetX()) max.SetX(v.GetX())
    if (v.GetY() > max.GetY()) max.SetY(v.GetY())
    if (v.GetZ() > max.GetZ()) max.SetZ(v.GetZ())
}

export function filterNonPhysicsNodes(nodes: RigidNodeReadOnly[], mira: mirabuf.Assembly): RigidNodeReadOnly[] {
    return nodes.filter(x => {
        for (const part of x.parts) {
            const inst = mira.data!.parts!.partInstances![part]!
            const def = mira.data!.parts!.partDefinitions![inst.partDefinitionReference!]!
            if (def.bodies && def.bodies.length > 0) return true
        }
        return false
    })
}

export function getPerpendicular(vec: Jolt.Vec3): Jolt.Vec3 {
    return tryGetPerpendicular(vec, new JOLT.Vec3(0, 1, 0)) ?? tryGetPerpendicular(vec, new JOLT.Vec3(0, 0, 1))!
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

export default MirabufPhysicsHandler
