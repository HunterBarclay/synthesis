import type Jolt from "@azaleacolburn/jolt-physics"
import * as THREE from "three"
import type { mirabuf } from "@/proto/mirabuf"
import type {
    LocalSceneObjectId,
    RemoteSceneObjectId,
} from "@/systems/multiplayer/types"
import { BodyAssociate } from "@/systems/physics/BodyAssociate.ts"
import type Mechanism from "@/systems/physics/Mechanism"
import type { LayerReserve } from "@/systems/physics/PhysicsSystem"
import PreferencesSystem from "@/systems/preferences/PreferencesSystem"
import {
    defaultRobotSpawnLocation,
    type SpawnLocation,
} from "@/systems/preferences/PreferenceTypes"
import type GizmoSceneObject from "@/systems/scene/GizmoSceneObject"
import type { SimConfigData } from "@/systems/simulation/SimConfigShared"
import World from "@/systems/World"
import type { ContextData, ContextSupplier } from "@/ui/components/ContextMenuData"
import type { ProgressHandle } from "@/ui/components/ProgressNotificationData"
import { ConfigMode } from "@/ui/panels/configuring/assembly-config/ConfigTypes"
import ConfigurePanel from "@/ui/panels/configuring/assembly-config/ConfigurePanel"
import JOLT from "@/util/loading/JoltSyncLoader"
import {
    convertJoltMat44ToThreeMatrix4,
    convertJoltRVec3ToJoltVec3,
    convertJoltVec3ToJoltRVec3,
    convertJoltVec3ToThreeVector3,
    convertThreeVector3ToJoltVec3,
} from "@/util/TypeConversions"
import { createMeshForShape } from "@/util/threejs/MeshCreation.ts"
import SceneObject from "@/systems/scene/SceneObject"
import MirabufInstance from "../MirabufInstance"
import { MiraType } from "../MirabufLoader"
import MirabufParser, { ParseErrorSeverity, type RigidNodeId, type RigidNodeReadOnly } from "../MirabufParser"
import { CustomOrbitControls } from "@/systems/scene/camera/CameraControls"
import CameraFocusProvider from "@/systems/scene/camera/CameraFocusProvider"

const DEBUG_BODIES = true

interface RnDebugMeshes {
    colliderMesh: THREE.Mesh
    comMesh: THREE.Mesh
}

class PrototypeSceneObject extends SceneObject implements ContextSupplier, CameraFocusProvider {
    private readonly _assemblyName: string
    private readonly _mirabufInstance: MirabufInstance
    private readonly _mechanism: Mechanism

    private _debugBodies: Map<string, RnDebugMeshes> | null
    private _physicsLayerReserve: LayerReserve | undefined

    private _simConfigData: SimConfigData | undefined

    private _centerOfMassIndicator: THREE.Mesh | undefined
    private _basePositionTransform: THREE.Vector3 | undefined

    public set mirabufInstance(a: MirabufInstance) {
        this.mirabufInstance = a
    }

    get mirabufInstance() {
        return this._mirabufInstance
    }

    get mechanism() {
        return this._mechanism
    }

    get simConfigData() {
        return this._simConfigData
    }

    public get miraType(): MiraType {
        return this._mirabufInstance.parser.assembly.dynamic ? MiraType.ROBOT : MiraType.FIELD
    }

    public get rootNodeId(): string {
        return this._mirabufInstance.parser.rootNode
    }

    public constructor(
        mirabufInstance: MirabufInstance,
        assemblyName: string,
        progressHandle?: ProgressHandle
    ) {
        super()
        this._mirabufInstance = mirabufInstance
        this._assemblyName = assemblyName

        progressHandle?.update("Creating mechanism...", 0.9)

        this._mechanism = World.physicsSystem.createMechanismFromParser(this._mirabufInstance.parser)
        if (this._mechanism.layerReserve) this._physicsLayerReserve = this._mechanism.layerReserve

        World.physicsSystem.setBodyMotionType(
            this._mechanism.getBodyByNodeId(this._mechanism.rootBody)!,
            JOLT.EMotionType_Static
        )

        this._debugBodies = null

        if (this.miraType === MiraType.ROBOT) {
            // Center of Mass Indicator
            const material = new THREE.MeshBasicMaterial({
                color: 0xff00ff, // purple
                transparent: true,
                opacity: 0.1,
                wireframe: true,
            })
            material.depthTest = false
            this._centerOfMassIndicator = new THREE.Mesh(new THREE.SphereGeometry(0.02), material)
            this._centerOfMassIndicator.visible = false
            World.sceneRenderer.scene.add(this._centerOfMassIndicator)
        }
    }

    public setup(): void {
        // Rendering
        this._mirabufInstance.addToScene(World.sceneRenderer.scene)

        if (DEBUG_BODIES) {
            this._debugBodies = new Map()
            this._mechanism.nodeToBody.forEach((bodyId, rnName) => {
                const body = World.physicsSystem.getBody(bodyId)

                const colliderMesh = this.createMeshForShape(body.GetShape())
                const comMesh = World.sceneRenderer.createSphere(0.05)
                World.sceneRenderer.scene.add(colliderMesh)
                World.sceneRenderer.scene.add(comMesh)
                ;(comMesh.material as THREE.Material).depthTest = false
                this._debugBodies!.set(rnName, {
                    colliderMesh: colliderMesh,
                    comMesh: comMesh,
                })
            })
        }

        const rigidNodes = this._mirabufInstance.parser.rigidNodes
        this._mechanism.nodeToBody.forEach((bodyId, rigidNodeId) => {
            const rigidNode = rigidNodes.get(rigidNodeId)
            if (!rigidNode) {
                console.warn("Found a RigidNodeId with no related RigidNode. Skipping for now...")
                return
            }
            World.physicsSystem.setBodyAssociation(new PrototypeRigidNodeAssociate(this, rigidNode, bodyId))
        })

        this.updateBatches()

        this._basePositionTransform = this.getPositionTransform(new THREE.Vector3())

        this.moveToSpawnLocation()

        console.debug(`WTJGDJGSKJKDS`)

        // TODO: Setup camera controls
        const cameraControls = World.sceneRenderer.currentCameraControls as CustomOrbitControls

        if (!cameraControls.focusProvider) {
            cameraControls.focusProvider = this
            console.debug(`Focus provider set to: ${this}`)
        } else {
            console.debug(`Focus provider already set to: ${cameraControls.focusProvider}`)
        }
    }

    // Centered in xz plane, bottom surface of object
    public getPositionTransform(vec: THREE.Vector3 = new THREE.Vector3()) {
        const box = this.computeBoundingBox()
        const transform = box.getCenter(vec)
        transform.setY(box.min.y)
        return transform
    }

    public moveToSpawnLocation() {
        const pos = new THREE.Vector3();
        this.computeBoundingBox().getCenter(pos)
        console.debug(`Bounding box center: ${pos.x}, ${pos.y}, ${pos.z}`)
        this.setObjectPosition({ pos: [ 0, 0, 0 ], yaw: 0 }, new THREE.Vector3(0, 0, 0));
    }

    private setObjectPosition(initialPos: SpawnLocation, referencePosition: THREE.Vector3) {
        const bounds = this.computeBoundingBox()
        if (!Number.isFinite(bounds.min.y)) return

        // If anyone has ideas on how to make this more concise I would appreciate.
        // It took much longer than expected to deal with this
        // (set position seems to use some arbitrary part of the robot, Dozer's is like half a meter in front to the left and 2471's is in the center)
        const bodyCenter = convertThreeVector3ToJoltVec3(bounds.getCenter(new THREE.Vector3()))
        const rotatedBasePositionTransform = this._basePositionTransform!.clone().applyAxisAngle(
            new THREE.Vector3(0, 1, 0),
            initialPos.yaw
        )
        const initialTranslation = new JOLT.Vec3(
            initialPos.pos[0] - rotatedBasePositionTransform.x + referencePosition.x,
            initialPos.pos[1] - rotatedBasePositionTransform.y + referencePosition.y,
            initialPos.pos[2] - rotatedBasePositionTransform.z + referencePosition.z
        )
        const initialRotation = JOLT.Quat.prototype.sRotation(new JOLT.Vec3(0, 1, 0), initialPos.yaw)
        this._mirabufInstance.parser.rigidNodes.forEach(rn => {
            const jBodyId = this._mechanism.getBodyByNodeId(rn.id)
            if (!jBodyId) return
            const offset = convertJoltRVec3ToJoltVec3(
                World.physicsSystem.getBody(jBodyId).GetPosition().Sub(bodyCenter)
            )
            const newPos = convertJoltVec3ToJoltRVec3(initialTranslation)
            World.physicsSystem.setBodyPositionRotationAndVelocity(
                jBodyId,
                newPos,
                initialRotation,
                new JOLT.Vec3(),
                new JOLT.Vec3()
            )

            JOLT.destroy(offset)
            JOLT.destroy(newPos)
        })
        JOLT.destroy(initialTranslation)
        JOLT.destroy(initialRotation)
        this.updateMeshTransforms()
    }

    public update(): void {
        this.updateMeshTransforms()
        this.updateBatches()
    }

    public dispose(): void {
        // TODO: Dispose of any resources

        this._mechanism.nodeToBody.forEach(bodyId => {
            World.physicsSystem.removeBodyAssociation(bodyId)
        })

        World.physicsSystem.destroyMechanism(this._mechanism)
        this._mirabufInstance.dispose(World.sceneRenderer.scene)
        this._debugBodies?.forEach(x => {
            World.sceneRenderer.scene.remove(x.colliderMesh, x.comMesh)
            x.colliderMesh.geometry.dispose()
            x.comMesh.geometry.dispose()
            ;(x.colliderMesh.material as THREE.Material).dispose()
            ;(x.comMesh.material as THREE.Material).dispose()
        })
        this._debugBodies?.clear()
        this._physicsLayerReserve?.release()
        if (this._centerOfMassIndicator) {
            World.sceneRenderer.scene.remove(this._centerOfMassIndicator)
            this._centerOfMassIndicator = undefined
        }
    }

    private createMeshForShape(shape: Jolt.Shape): THREE.Mesh {
        const geometry = createMeshForShape(shape)

        const material = new THREE.MeshStandardMaterial({
            color: 0x33ff33,
            wireframe: true,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.castShadow = true

        return mesh
    }

    /**
     * Matches mesh transforms to their Jolt counterparts.
     */
    public updateMeshTransforms() {
        let weightedCOM = new JOLT.RVec3(0, 0, 0)
        let totalMass = 0
        this._mirabufInstance.parser.rigidNodes.forEach(rn => {
            if (!this._mirabufInstance.meshes.size) return // if this.dispose() has been ran then return
            const bodyId = this._mechanism.getBodyByNodeId(rn.id)!
            const body = World.physicsSystem.getBody(bodyId)
            if (!body) return
            const transform = convertJoltMat44ToThreeMatrix4(body.GetWorldTransform())
            this.updateNodeParts(rn, transform)

            if (Number.isNaN(body.GetPosition().GetX())) {
                const vel = body.GetLinearVelocity()
                const pos = body.GetPosition()
                console.warn(
                    `Invalid Position.\nPosition => ${pos.GetX()}, ${pos.GetY()}, ${pos.GetZ()}\nVelocity => ${vel.GetX()}, ${vel.GetY()}, ${vel.GetZ()}`
                )
            }

            if (this._debugBodies) {
                const { colliderMesh, comMesh } = this._debugBodies.get(rn.id)!
                colliderMesh.position.setFromMatrixPosition(transform)
                colliderMesh.rotation.setFromRotationMatrix(transform)

                const comTransform = convertJoltMat44ToThreeMatrix4(body.GetCenterOfMassTransform())

                comMesh.position.setFromMatrixPosition(comTransform)
                comMesh.rotation.setFromRotationMatrix(comTransform)
            }
            if (this._centerOfMassIndicator) {
                const inverseMass = body.GetMotionProperties().GetInverseMass()

                if (inverseMass > 0) {
                    const mass = 1 / inverseMass
                    weightedCOM = weightedCOM.AddRVec3(body.GetCenterOfMassPosition().Mul(mass))
                    totalMass += mass
                }
            }
        })
        if (this._centerOfMassIndicator) {
            const netCoM = totalMass > 0 ? weightedCOM.Div(totalMass) : weightedCOM
            this._centerOfMassIndicator.position.set(netCoM.GetX(), netCoM.GetY(), netCoM.GetZ())
            this._centerOfMassIndicator.visible = PreferencesSystem.getGlobalPreference("ShowCenterOfMassIndicators")
        }
    }

    public updateNodeParts(rn: RigidNodeReadOnly, transform: THREE.Matrix4) {
        rn.parts.forEach(part => {
            const partTransform = this._mirabufInstance.parser.globalTransforms
                .get(part)!
                .clone()
                .premultiply(transform)
            const meshes = this._mirabufInstance.meshes.get(part) ?? []
            meshes.forEach(([mesh, index]) => {
                mesh.setMatrixAt(index, partTransform)
                // Only update instanceMatrix for InstancedMesh
                if ("instanceMatrix" in mesh) {
                    mesh.instanceMatrix.needsUpdate = true
                }
            })
        })
    }

    /** Updates the batch computations */
    private updateBatches() {
        this._mirabufInstance.batches.forEach(x => {
            x.computeBoundingBox()
            x.computeBoundingSphere()
        })
    }

    /**
     * Calculates the bounding box of the mirabuf object.
     *
     * @returns The bounding box of the mirabuf object.
     */
    private computeBoundingBox(): THREE.Box3 {
        const box = new THREE.Box3()
        this._mirabufInstance.batches.forEach(batch => {
            if (batch.boundingBox) box.union(batch.boundingBox)
        })

        return box
    }

    /**
     * Gets the maximum dimensions (length, width, height) of the mirabuf object.
     *
     * @returns An object containing the width (x), height (y), and depth (z) dimensions in meters.
     */
    public getDimensions(): { width: number; height: number; depth: number } {
        const boundingBox = this.computeBoundingBox()
        const size = new THREE.Vector3()
        boundingBox.getSize(size)

        return {
            width: size.x,
            height: size.y,
            depth: size.z,
        }
    }

    /**
     * Calculates the robot's dimensions as if it had no rotation applied.
     *
     * @returns the object containing the width (x), height (y), and depth (z) dimensions in meters.
     */
    public getDimensionsWithoutRotation(): {
        width: number
        height: number
        depth: number
    } {
        const rootNodeId = this.getRootNodeId()
        if (!rootNodeId) {
            console.warn("No root node found for robot, using regular dimensions")
            return this.getDimensions()
        }

        const rootBody = World.physicsSystem.getBody(rootNodeId)
        const rootTransform = convertJoltMat44ToThreeMatrix4(rootBody.GetWorldTransform())

        const rootPosition = new THREE.Vector3()
        const rootRotation = new THREE.Quaternion()
        const rootScale = new THREE.Vector3()
        rootTransform.decompose(rootPosition, rootRotation, rootScale)

        // Create inverse rotation matrix to "undo" the robot's rotation
        const inverseRotation = new THREE.Matrix4().makeRotationFromQuaternion(rootRotation.clone().invert())

        const unrotatedBox = new THREE.Box3()

        this._mirabufInstance.parser.rigidNodes.forEach(rigidNode => {
            const bodyId = this._mechanism.getBodyByNodeId(rigidNode.id)
            if (!bodyId) return

            const body = World.physicsSystem.getBody(bodyId)
            const bodyTransform = convertJoltMat44ToThreeMatrix4(body.GetWorldTransform())

            const shape = body.GetShape()
            const scale = new JOLT.Vec3(1, 1, 1)
            const triangleContext = new JOLT.ShapeGetTriangles(
                shape,
                JOLT.AABox.prototype.sBiggest(),
                shape.GetCenterOfMass(),
                JOLT.Quat.prototype.sIdentity(),
                scale
            )

            try {
                const vertices = new Float32Array(
                    JOLT.HEAP32.buffer,
                    triangleContext.GetVerticesData(),
                    triangleContext.GetVerticesSize() / Float32Array.BYTES_PER_ELEMENT
                )

                for (let i = 0; i < vertices.length; i += 3) {
                    const vertex = new THREE.Vector3(vertices[i], vertices[i + 1], vertices[i + 2])

                    vertex.applyMatrix4(bodyTransform).applyMatrix4(inverseRotation)

                    unrotatedBox.expandByPoint(vertex)
                }
            } finally {
                JOLT.destroy(triangleContext)
                JOLT.destroy(scale)
            }
        })

        // Fallback if no vertices were processed
        if (unrotatedBox.isEmpty()) {
            console.warn("Could not process physics shapes, using regular dimensions")
            return this.getDimensions()
        }

        const unrotatedSize = new THREE.Vector3()
        unrotatedBox.getSize(unrotatedSize)

        return {
            width: unrotatedSize.x,
            height: unrotatedSize.y,
            depth: unrotatedSize.z,
        }
    }

    /**
     * Once a gizmo is created and attached to this mirabuf object, this will be executed to align the gizmo correctly.
     *
     * @param gizmo Gizmo attached to the mirabuf object
     */
    public postGizmoCreation(gizmo: GizmoSceneObject) {
        const jRootId = this.getRootNodeId()
        if (!jRootId) {
            console.error("No root node found.")
            return
        }

        const jBody = World.physicsSystem.getBody(jRootId)
        if (jBody.IsStatic()) {
            const aaBox = jBody.GetWorldSpaceBounds()
            const mat = new THREE.Matrix4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
            const center = aaBox.mMin.Add(aaBox.mMax).Div(2.0)
            mat.compose(
                convertJoltVec3ToThreeVector3(center),
                new THREE.Quaternion(0, 0, 0, 1),
                new THREE.Vector3(1, 1, 1)
            )
            gizmo.setTransform(mat)
        } else {
            gizmo.setTransform(convertJoltMat44ToThreeMatrix4(jBody.GetCenterOfMassTransform()))
        }
    }

    public enablePhysics() {
        if (World.multiplayerSystem?.getOwnSceneObjectIDs().includes(this.id as LocalSceneObjectId)) {
            World.multiplayerSystem.broadcast({ type: "enableObjectPhysics", data: this.id as RemoteSceneObjectId })
        }

        this._mirabufInstance.parser.rigidNodes.forEach(rn => {
            World.physicsSystem.enablePhysicsForBody(this._mechanism.getBodyByNodeId(rn.id)!)
        })
        this._mechanism.ghostBodies.forEach(x => World.physicsSystem.enablePhysicsForBody(x))
    }

    public disablePhysics() {
        if (World.multiplayerSystem?.getOwnSceneObjectIDs().includes(this.id as LocalSceneObjectId)) {
            World.multiplayerSystem.broadcast({ type: "disableObjectPhysics", data: this.id as RemoteSceneObjectId })
        }

        this._mirabufInstance.parser.rigidNodes.forEach(rn => {
            World.physicsSystem.disablePhysicsForBody(this._mechanism.getBodyByNodeId(rn.id)!)
        })
        this._mechanism.ghostBodies.forEach(x => World.physicsSystem.disablePhysicsForBody(x))
    }

    public hasPhysics(): boolean {
        const rootBody = World.physicsSystem.getBody(this.getRootNodeId()!)
        return rootBody.IsActive() && !rootBody.IsSensor()
    }

    public getRootNodeId(): Jolt.BodyID | undefined {
        return this._mechanism.getBodyByNodeId(this._mechanism.rootBody)
    }

    public loadFocusTransform(mat: THREE.Matrix4) {
        const rootNodeId = this.getRootNodeId()
        if (!rootNodeId) return
        const rootBody = World.physicsSystem.getBody(rootNodeId)
        if (!rootBody) return
        const center = convertJoltVec3ToThreeVector3(rootBody.GetShape().GetLocalBounds().GetCenter())
        mat.makeTranslation(center.x, center.y, center.z)
    }

    public getSupplierData(): ContextData {
        const data: ContextData = {
            title: `${this._assemblyName}`,
            items: [],
        }

        if (World.sceneRenderer.currentCameraControls.controlsType == "Orbit") {
            const cameraControls = World.sceneRenderer.currentCameraControls as CustomOrbitControls
            if (cameraControls.focusProvider == this) {
                data.items.push({
                    name: "Camera: Unfocus",
                    func: () => {
                        cameraControls.unfocus()
                    },
                })

                if (cameraControls.locked) {
                    data.items.push({
                        name: "Camera: Unlock",
                        func: () => {
                            cameraControls.locked = false
                        },
                    })
                } else {
                    data.items.push({
                        name: "Camera: Lock",
                        func: () => {
                            cameraControls.locked = true
                        },
                    })
                }
            } else {
                data.items.push({
                    name: "Camera: Focus",
                    func: () => {
                        cameraControls.focusProvider = this
                    },
                })
            }
        }

        data.items.push({
            name: "Remove",
            func: () => {
                World.sceneRenderer.removeSceneObject(this.id)
            },
        })

        return data
    }

    public getAllBodyIds(): Jolt.BodyID[] {
        return [...this.mechanism.nodeToBody.values()]
    }

    public getAllBodies(): Jolt.Body[] {
        return [...this.mechanism.nodeToBody.values()]
            .map(bodyId => World.physicsSystem.getBody(bodyId))
            .filter(body => body != null)
    }
}

export async function createPrototype(
    assembly: mirabuf.Assembly,
    progressHandle?: ProgressHandle
): Promise<PrototypeSceneObject | null | undefined> {
    const parser = new MirabufParser(assembly, progressHandle)
    if (parser.maxErrorSeverity >= ParseErrorSeverity.UNIMPORTABLE) {
        console.error(`Assembly Parser produced significant errors for '${assembly.info!.name!}'`)
        return
    }

    return new PrototypeSceneObject(new MirabufInstance(parser), assembly.info!.name!, progressHandle)
}

/**
 * Body association to a rigid node with a given mirabuf scene object.
 */
export class PrototypeRigidNodeAssociate extends BodyAssociate {
    public readonly sceneObject: PrototypeSceneObject
    public robotLastInContactWith: PrototypeSceneObject | null = null
    public static readonly associateId: string = 'PrototypeSceneObject'

    public readonly rigidNode: RigidNodeReadOnly

    public get rigidNodeId(): RigidNodeId {
        return this.rigidNode.id
    }

    public get isGamePiece(): boolean {
        return this.rigidNode.isGamePiece
    }

    public constructor(sceneObject: PrototypeSceneObject, rigidNode: RigidNodeReadOnly, body: Jolt.BodyID) {
        super(body)
        this.sceneObject = sceneObject
        this.rigidNode = rigidNode
    }
}

export default PrototypeSceneObject
