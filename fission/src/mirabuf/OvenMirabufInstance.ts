import * as THREE from "three"
import MirabufInstance from "./MirabufInstance"
import type MirabufParser from "./MirabufParser"
import type { RigidNodeReadOnly } from "./MirabufParser"
import type { OvenBodyKeyframe, OvenBodyState, Vec3Tuple, QuatTuple } from "@/systems/physics/oven/OvenProtocol"

/**
 * Manages the ThreeJS representation of a mirabuf asset for Oven
 * simulation playback. Unlike MirabufSceneObject which syncs with
 * live Jolt bodies, this reads transforms from Oven body states
 * and recorded keyframes.
 *
 * Also tracks a root transform (position + rotation) that can be
 * manipulated by a gizmo before simulation starts.
 */
class OvenMirabufInstance {
    private _instance: MirabufInstance
    private _parser: MirabufParser
    private _rigidNodes: Map<string, RigidNodeReadOnly>
    private _assemblyIndex: number
    private _bodyPrefix: string

    private _rootObject: THREE.Object3D

    public get parser(): MirabufParser {
        return this._parser
    }

    public get instance(): MirabufInstance {
        return this._instance
    }

    public get rigidNodeIds(): string[] {
        return [...this._rigidNodes.keys()]
    }

    public get rootObject(): THREE.Object3D {
        return this._rootObject
    }

    public get assemblyIndex(): number {
        return this._assemblyIndex
    }

    public set assemblyIndex(value: number) {
        this._assemblyIndex = value
        this._bodyPrefix = `_asm${value}_`
    }

    constructor(parser: MirabufParser, assemblyIndex: number) {
        this._parser = parser
        this._instance = new MirabufInstance(parser)
        this._rigidNodes = parser.rigidNodes
        this._assemblyIndex = assemblyIndex
        this._bodyPrefix = `_asm${assemblyIndex}_`
        this._rootObject = new THREE.Object3D()
    }

    public addToScene(scene: THREE.Scene): void {
        this._instance.addToScene(scene)
        scene.add(this._rootObject)
    }

    public removeFromScene(scene: THREE.Scene): void {
        this._instance.dispose(scene)
        scene.remove(this._rootObject)
    }

    public getPosition(): Vec3Tuple {
        const p = this._rootObject.position
        return [p.x, p.y, p.z]
    }

    public getRotation(): QuatTuple {
        const q = this._rootObject.quaternion
        return [q.x, q.y, q.z, q.w]
    }

    public setTransform(position: Vec3Tuple, rotation: QuatTuple): void {
        this._rootObject.position.set(...position)
        this._rootObject.quaternion.set(...rotation)
        this._rootObject.updateMatrix()
        this.applyRootTransformToMeshes()
    }

    /**
     * Re-render all meshes using the root transform so the visual
     * matches the gizmo position before simulation starts.
     */
    private applyRootTransformToMeshes(): void {
        const rootMatrix = this._rootObject.matrix

        for (const [, rn] of this._rigidNodes) {
            rn.parts.forEach(part => {
                const partTransform = this._parser.globalTransforms
                    .get(part)!
                    .clone()
                    .premultiply(rootMatrix)
                const meshes = this._instance.meshes.get(part) ?? []
                meshes.forEach(([mesh, index]) => {
                    mesh.setMatrixAt(index, partTransform)
                    if ("instanceMatrix" in mesh) {
                        mesh.instanceMatrix.needsUpdate = true
                    }
                })
            })
        }
        this.updateBatches()
    }

    /**
     * Apply a set of body states (position + rotation per rigid node)
     * from an Oven GetBodyStates response.
     */
    public applyBodyStates(bodies: OvenBodyState[]): void {
        for (const state of bodies) {
            this.applyNodeTransform(state.bodyId, state.position, state.rotation)
        }
        this.updateBatches()
    }

    /**
     * Scrub to a normalized time (0–1) within a flat recording.
     * Interpolates position (lerp) and rotation (slerp) between
     * the two nearest keyframes.
     */
    public scrubToNormalized(
        t: number,
        flatRecording: Map<string, OvenBodyKeyframe[]>,
        totalFrames: number,
    ): void {
        if (totalFrames < 2) return

        const clamped = Math.max(0, Math.min(1, t))
        const floatIndex = clamped * (totalFrames - 1)
        const low = Math.floor(floatIndex)
        const high = Math.min(low + 1, totalFrames - 1)
        const alpha = floatIndex - low

        const tmpPosA = new THREE.Vector3()
        const tmpPosB = new THREE.Vector3()
        const tmpQuatA = new THREE.Quaternion()
        const tmpQuatB = new THREE.Quaternion()

        for (const [bodyId, keyframes] of flatRecording) {
            const nodeId = bodyId.startsWith(this._bodyPrefix) ? bodyId.slice(this._bodyPrefix.length) : bodyId
            if (!this._rigidNodes.has(nodeId)) continue

            const kfA = keyframes[low]
            const kfB = keyframes[high]

            tmpPosA.set(...kfA.position)
            tmpPosB.set(...kfB.position)
            const pos: Vec3Tuple = [
                tmpPosA.x + (tmpPosB.x - tmpPosA.x) * alpha,
                tmpPosA.y + (tmpPosB.y - tmpPosA.y) * alpha,
                tmpPosA.z + (tmpPosB.z - tmpPosA.z) * alpha,
            ]

            tmpQuatA.set(...kfA.rotation)
            tmpQuatB.set(...kfB.rotation)
            tmpQuatA.slerp(tmpQuatB, alpha)
            const rot: QuatTuple = [tmpQuatA.x, tmpQuatA.y, tmpQuatA.z, tmpQuatA.w]

            this.applyNodeTransform(bodyId, pos, rot)
        }
        this.updateBatches()
    }

    /**
     * Build a world-space transform matrix from a position and quaternion,
     * then update all meshes belonging to this rigid node's parts.
     */
    private applyNodeTransform(bodyId: string, position: Vec3Tuple, rotation: QuatTuple): void {
        const nodeId = bodyId.startsWith(this._bodyPrefix) ? bodyId.slice(this._bodyPrefix.length) : bodyId
        const rn = this._rigidNodes.get(nodeId)
        if (!rn) return

        const worldTransform = new THREE.Matrix4().compose(
            new THREE.Vector3(...position),
            new THREE.Quaternion(...rotation),
            new THREE.Vector3(1, 1, 1),
        )

        rn.parts.forEach(part => {
            const partTransform = this._parser.globalTransforms
                .get(part)!
                .clone()
                .premultiply(worldTransform)
            const meshes = this._instance.meshes.get(part) ?? []
            meshes.forEach(([mesh, index]) => {
                mesh.setMatrixAt(index, partTransform)
                if ("instanceMatrix" in mesh) {
                    mesh.instanceMatrix.needsUpdate = true
                }
            })
        })
    }

    private updateBatches(): void {
        this._instance.batches.forEach(x => {
            x.computeBoundingBox()
            x.computeBoundingSphere()
        })
    }
}

export default OvenMirabufInstance
