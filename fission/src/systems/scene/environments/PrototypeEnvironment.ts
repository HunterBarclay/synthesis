import World from "@/systems/World";
import SceneEnvironment from "./SceneEnvironment";
import skyboxVS from "@/shaders/proto_skybox_vs.glsl"
import skyboxFS from "@/shaders/proto_skybox_fs.glsl"
import groundVS from "@/shaders/box_cross_ground_vs.glsl"
import groundFS from "@/shaders/box_cross_ground_fs.glsl"
import * as THREE from "three"
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js"
import { ContextData } from "@/ui/components/ContextMenuData";
import JOLT from "@/util/loading/JoltSyncLoader"
import PreferencesSystem from "@/systems/preferences/PreferencesSystem";
import { CustomOrbitControls } from "../camera/CameraControls";
import ImportPrototypeModal from "@/ui/modals/mirabuf/ImportPrototypeModal";
import OvenHandler from "@/systems/physics/oven/OvenHandler"
import type { OvenTray, OvenTrayAssembly, OvenJointMotor, OvenBodyKeyframe, Vec3Tuple, QuatTuple } from "@/systems/physics/oven/OvenProtocol"
import type { OvenRecordingChunk } from "@/systems/physics/oven/OvenHandler"
import MirabufParser, { GROUNDED_JOINT_ID } from "@/mirabuf/MirabufParser"
import OvenMirabufInstance from "@/mirabuf/OvenMirabufInstance"
import { mirabuf } from "@/proto/mirabuf"

const OVEN_TIMESTEP = 1.0 / 240.0
const SIMULATE_SECONDS = 10
const SIMULATE_STEPS = Math.round(SIMULATE_SECONDS / OVEN_TIMESTEP)

const RECORDER_FRAMERATE = 60
const RECORDER_MAX_FRAME_BUFFER = 300
const PROGRESS_INTERVAL = Math.round(SIMULATE_STEPS / 20)

const GROUND_BODY_ID = "_env_ground"
const GROUND_HALF_EXTENTS: Vec3Tuple = [5.0, 0.5, 5.0]
const GROUND_POSITION: Vec3Tuple = [0.0, -0.5, 0.0]

class PrototypeEnvironment extends SceneEnvironment {

    private _directionalLight: THREE.DirectionalLight | undefined
    private _ambientLight: THREE.AmbientLight | undefined
    private _skybox: THREE.Mesh | undefined
    private _ground: THREE.Mesh | undefined

    private _oven: OvenHandler | undefined
    private _ovenActionHandler: ((e: Event) => void) | undefined
    private _recordingChunks: OvenRecordingChunk[] = []
    private _flatRecording: Map<string, OvenBodyKeyframe[]> = new Map()
    private _totalRecordedFrames: number = 0

    private _tray: OvenTray = { bodies: [], joints: [] }
    private _assemblyVisuals: OvenMirabufInstance[] = []
    private _assemblyNames: string[] = []

    private _editingLocked: boolean = false
    private _simulationPending: boolean = false

    private _activeGizmo: TransformControls | undefined
    private _activeGizmoIndex: number = -1
    private _gizmoDragListener: (() => void) | undefined
    private _gizmoDraggingListener: ((e: { value: unknown }) => void) | undefined

    private _groundEnabled: boolean = false

    public createEnvironment(): void {
        const sceneRenderer = World.sceneRenderer;

        this._ambientLight = new THREE.AmbientLight(0xffffff, 3.0)
        sceneRenderer.addObject(this._ambientLight)
        
        // this._directionalLight = new THREE.DirectionalLight(0xffffff, 5.0)
        // const lightDirection = new THREE.Vector3(1.0, -3.0, -2.0).normalize()
        // this._directionalLight.position.copy(lightDirection.clone().multiplyScalar(-1))
        // this._directionalLight.castShadow = true
        // this._directionalLight.shadow.camera.top = 5
        // this._directionalLight.shadow.camera.bottom = -5
        // this._directionalLight.shadow.camera.left = -5
        // this._directionalLight.shadow.camera.right = 5
        // this._directionalLight.shadow.mapSize = new THREE.Vector2(1024, 1024)
        // this._directionalLight.shadow.blurSamples = 16
        // this._directionalLight.shadow.bias = 0.0
        // this._directionalLight.shadow.normalBias = 0.01
        // sceneRenderer.addObject(this._directionalLight)

        const pointLight1 = new THREE.PointLight(0x96ffff, 20.0, 20, 2)
        pointLight1.position.set(0, 3, 3)
        sceneRenderer.addObject(pointLight1)

        const pointLight2 = new THREE.PointLight(0xff8fff, 20.0, 20, 2)
        pointLight2.position.set(2, 3, -1)
        sceneRenderer.addObject(pointLight2)

        const pointLight3 = new THREE.PointLight(0xffff8f, 20.0, 20, 2)
        pointLight3.position.set(-1, 3, -2)
        sceneRenderer.addObject(pointLight3)

        const skyboxGeometry = new THREE.SphereGeometry(250)
        const skyboxMaterial = new THREE.ShaderMaterial({
            vertexShader: skyboxVS,
            fragmentShader: skyboxFS,
            side: THREE.BackSide,
            uniforms: {
                rColor: { value: 1.0 },
                gColor: { value: 1.0 },
                bColor: { value: 1.0 },
            },
        })

        this._skybox = new THREE.Mesh(skyboxGeometry, skyboxMaterial)
        this._skybox.receiveShadow = false
        this._skybox.castShadow = false
        sceneRenderer.addObject(this._skybox)

        const dotColor: THREE.Color = new THREE.Color(0x3d5273);

        const groundGeometry = new THREE.PlaneGeometry(100, 100)
        const groundMaterial = new THREE.ShaderMaterial({
            vertexShader: groundVS,
            fragmentShader: groundFS,
            side: THREE.DoubleSide,
            transparent: true,
            uniforms: {
                rColor: { value: dotColor.r },
                gColor: { value: dotColor.g },
                bColor: { value: dotColor.b },
                crossStep: { value: 0.75 },
                crossLineWidth: { value: 0.008 },
                crossLineLength: { value: 0.05 },
                fadeInnerRadius: { value: 5.0 },
                fadeOuterRadius: { value: 7.0 },
                focusPoint: { value: [ 0.0, 0.0, 0.0 ] },
            },
        })
        this._ground = new THREE.Mesh(groundGeometry, groundMaterial)
        this._ground.rotation.set(Math.PI / 2, 0.0, 0.0)
        this._ground.position.set(0.0, 0.0, 0.0)
        this._ground.receiveShadow = true
        this._ground.castShadow = false
        sceneRenderer.addObject(this._ground)

        World.physicsSystem.setGravity(new JOLT.Vec3(0, 0, 0));

        World.dragModeSystem.enabled = true;

        PreferencesSystem.setGlobalPreference('ShowViewCube', false);

        this._oven = new OvenHandler()
        this._oven.onReady = () => {
            this._oven!.configure({ progressInterval: PROGRESS_INTERVAL })
            console.log("[Oven] Ready — waiting for simulate action to load tray")
        }
        this._oven.onError = (err) => {
            console.error(`[Oven] ${err}`)
            window.dispatchEvent(new CustomEvent("ovenResult", { detail: { action: "error" } }))
        }
        this._oven.onBodyStates = (bodies) => {
            for (const visual of this._assemblyVisuals) {
                visual.applyBodyStates(bodies)
            }

            if (this._simulationPending) {
                this._simulationPending = false
                this.flattenRecording()
                this._editingLocked = true
                window.dispatchEvent(new CustomEvent("ovenResult", {
                    detail: { action: "simulateDone", totalFrames: this._totalRecordedFrames },
                }))
                this.broadcastEditingState()
            }
        }
        this._oven.onRecordingData = (chunk) => {
            this._recordingChunks.push(chunk)
            console.log(`[Oven] Recording chunk: steps ${chunk.firstStep}–${chunk.lastStep} (${chunk.bodies[0]?.keyframes.length ?? 0} frames)`)
        }
        this._oven.onProgress = (completedSteps, totalSteps) => {
            window.dispatchEvent(new CustomEvent("ovenResult", {
                detail: { action: "progress", completedSteps, totalSteps },
            }))
        }
        this._oven.init()

        this._ovenActionHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail
            if (detail?.action === "simulate") {
                this.disableGizmo()
                this.syncTrayTransforms()
                this._recordingChunks = []
                this._flatRecording.clear()
                this._totalRecordedFrames = 0
                this._editingLocked = true
                this._simulationPending = true
                this.broadcastEditingState()
                this.loadTrayAndSimulate()
            } else if (detail?.action === "reset") {
                this._recordingChunks = []
                this._flatRecording.clear()
                this._totalRecordedFrames = 0
                this._editingLocked = false
                this._oven!.resetState()
                this._oven!.getBodyStates()
                this.restoreVisualTransforms()
                this.broadcastEditingState()
            } else if (detail?.action === "scrub") {
                for (const visual of this._assemblyVisuals) {
                    visual.scrubToNormalized(
                        detail.t as number,
                        this._flatRecording,
                        this._totalRecordedFrames,
                    )
                }
            } else if (detail?.action === "addAssembly") {
                if (this._editingLocked) {
                    console.warn("[Oven] Cannot add assembly while editing is locked (reset first)")
                    return
                }
                const assemblyData = detail.assemblyData as Uint8Array
                const assembly = detail.assembly as { info?: { name?: string } }
                const parser = new MirabufParser(detail.assembly)
                const name = assembly.info?.name ?? "Unnamed Assembly"
                const existingCount = this._assemblyVisuals.length
                const offset: Vec3Tuple = [existingCount * 1.5, 0, 0]
                const index = this.addAssembly(assemblyData, parser, name, offset)
                console.log(`[Oven] Added assembly ${index}: ${name}`)
            } else if (detail?.action === "removeAssembly") {
                if (this._editingLocked) return
                this.removeAssembly(detail.assemblyIndex as number)
            } else if (detail?.action === "setMotor") {
                if (this._editingLocked) return
                const asmIdx = detail.assemblyIndex as number
                const jGuid = detail.jointGuid as string
                const mode = detail.mode as "velocity" | "position"
                const tVal = detail.targetValue as number
                const mForce = detail.maxForce as number | undefined
                const visual = this._assemblyVisuals[asmIdx]
                const isRevolute = visual?.parser.assembly.data?.joints?.jointDefinitions
                    ? (() => {
                        const instances = visual.parser.assembly.data!.joints!.jointInstances!
                        const inst = instances[jGuid]
                        if (!inst) return false
                        const def = visual.parser.assembly.data!.joints!.jointDefinitions![inst.jointReference!]
                        return def?.jointMotionType === mirabuf.joint.JointMotion.REVOLUTE
                    })()
                    : false
                const motor: OvenJointMotor = {
                    jointGuid: jGuid,
                    mode,
                    targetValue: tVal,
                    ...(isRevolute ? { maxTorque: mForce } : { maxForce: mForce }),
                }
                this.setMotor(asmIdx, motor)
            } else if (detail?.action === "removeMotor") {
                if (this._editingLocked) return
                this.removeMotor(detail.assemblyIndex as number, detail.jointGuid as string)
            } else if (detail?.action === "setNodeFixed") {
                if (this._editingLocked) return
                this.setNodeFixed(detail.assemblyIndex as number, detail.nodeId as string, detail.fixed as boolean)
            } else if (detail?.action === "configureAssembly") {
                if (this._editingLocked) return
                const idx = detail.assemblyIndex as number
                if (this._tray.assemblies && idx >= 0 && idx < this._tray.assemblies.length) {
                    const asm = this._tray.assemblies[idx]
                    asm.initialLinearVelocity = detail.initialLinearVelocity as Vec3Tuple | undefined
                    asm.initialAngularVelocity = detail.initialAngularVelocity as Vec3Tuple | undefined
                    this.broadcastTrayState()
                }
            } else if (detail?.action === "gizmoTransformUpdate") {
                if (this._editingLocked) return
                const idx = detail.assemblyIndex as number
                const pos = detail.position as Vec3Tuple
                const rot = detail.rotation as QuatTuple
                this.updateAssemblyTransform(idx, pos, rot)
            } else if (detail?.action === "enableGizmo") {
                if (this._editingLocked) return
                this.enableGizmo(detail.assemblyIndex as number, (detail.mode as "translate" | "rotate") ?? "translate")
            } else if (detail?.action === "setGizmoMode") {
                if (this._activeGizmo) {
                    this._activeGizmo.setMode(detail.mode as "translate" | "rotate")
                }
            } else if (detail?.action === "disableGizmo") {
                this.disableGizmo()
            } else if (detail?.action === "setGroundEnabled") {
                if (this._editingLocked) return
                this.setGroundEnabled(detail.enabled as boolean)
            }
        }
        window.addEventListener("ovenAction", this._ovenActionHandler)
    }

    public addAssembly(assemblyData: Uint8Array, parser: MirabufParser, name = "Unnamed Assembly", initialPosition?: Vec3Tuple): number {
        if (!this._tray.assemblies) {
            this._tray.assemblies = []
        }

        const entry: OvenTrayAssembly = { assemblyData }
        if (initialPosition) {
            entry.position = initialPosition
        }
        this._tray.assemblies.push(entry)

        const assemblyIndex = this._tray.assemblies.length - 1
        const visual = new OvenMirabufInstance(parser, assemblyIndex)
        if (initialPosition) {
            visual.setTransform(initialPosition, [0, 0, 0, 1])
        }
        visual.addToScene(World.sceneRenderer.scene)
        this._assemblyVisuals.push(visual)
        this._assemblyNames.push(name)

        this.broadcastTrayState()

        return assemblyIndex
    }

    public removeAssembly(index: number): void {
        if (!this._tray.assemblies || index < 0 || index >= this._tray.assemblies.length) {
            console.warn(`[Oven] Invalid assembly index: ${index}`)
            return
        }

        this._tray.assemblies.splice(index, 1)
        this._assemblyNames.splice(index, 1)

        const visual = this._assemblyVisuals.splice(index, 1)[0]
        if (visual) {
            visual.removeFromScene(World.sceneRenderer.scene)
        }

        for (let i = index; i < this._assemblyVisuals.length; i++) {
            this._assemblyVisuals[i].assemblyIndex = i
        }

        this.broadcastTrayState()
    }

    public setMotor(assemblyIndex: number, motor: OvenJointMotor): void {
        if (!this._tray.assemblies || assemblyIndex < 0 || assemblyIndex >= this._tray.assemblies.length) {
            console.warn(`[Oven] Invalid assembly index: ${assemblyIndex}`)
            return
        }

        const asm = this._tray.assemblies[assemblyIndex]
        if (!asm.motors) {
            asm.motors = []
        }

        const existing = asm.motors.findIndex(m => m.jointGuid === motor.jointGuid)
        if (existing >= 0) {
            asm.motors[existing] = motor
        } else {
            asm.motors.push(motor)
        }

        this.broadcastTrayState()
    }

    public removeMotor(assemblyIndex: number, jointGuid: string): void {
        if (!this._tray.assemblies || assemblyIndex < 0 || assemblyIndex >= this._tray.assemblies.length) {
            console.warn(`[Oven] Invalid assembly index: ${assemblyIndex}`)
            return
        }

        const asm = this._tray.assemblies[assemblyIndex]
        if (!asm.motors) return

        const idx = asm.motors.findIndex(m => m.jointGuid === jointGuid)
        if (idx >= 0) {
            asm.motors.splice(idx, 1)
        }

        this.broadcastTrayState()
    }

    public setNodeFixed(assemblyIndex: number, nodeId: string, fixed: boolean): void {
        if (!this._tray.assemblies || assemblyIndex < 0 || assemblyIndex >= this._tray.assemblies.length) {
            console.warn(`[Oven] Invalid assembly index: ${assemblyIndex}`)
            return
        }

        const asm = this._tray.assemblies[assemblyIndex]
        if (!asm.nodeOverrides) {
            asm.nodeOverrides = {}
        }

        if (!asm.nodeOverrides[nodeId]) {
            asm.nodeOverrides[nodeId] = {}
        }
        asm.nodeOverrides[nodeId].fixed = fixed

        this.broadcastTrayState()
    }

    public setGroundEnabled(enabled: boolean): void {
        if (enabled === this._groundEnabled) return
        this._groundEnabled = enabled

        const existingIdx = this._tray.bodies.findIndex(b => b.bodyId === GROUND_BODY_ID)

        if (enabled) {
            if (existingIdx === -1) {
                this._tray.bodies.push({
                    bodyId: GROUND_BODY_ID,
                    halfExtents: GROUND_HALF_EXTENTS,
                    position: GROUND_POSITION,
                    rotation: [0, 0, 0, 1],
                    fixed: true,
                    friction: 0.6,
                    restitution: 0.3,
                })
            }

        } else {
            if (existingIdx >= 0) {
                this._tray.bodies.splice(existingIdx, 1)
            }
        }

        this.broadcastTrayState()
    }

    private updateAssemblyTransform(index: number, position: Vec3Tuple, rotation: QuatTuple): void {
        if (!this._tray.assemblies || index < 0 || index >= this._tray.assemblies.length) return

        this._tray.assemblies[index].position = position
        this._tray.assemblies[index].rotation = rotation

        const visual = this._assemblyVisuals[index]
        if (visual) {
            visual.setTransform(position, rotation)
        }
    }

    private enableGizmo(assemblyIndex: number, mode: "translate" | "rotate"): void {
        this.disableGizmo()

        const visual = this._assemblyVisuals[assemblyIndex]
        if (!visual) return

        const renderer = World.sceneRenderer
        const gizmo = new TransformControls(renderer.mainCamera, renderer.renderer.domElement)
        gizmo.setMode(mode)
        gizmo.setSpace("local")
        gizmo.attach(visual.rootObject)

        renderer.scene.add(gizmo.getHelper())

        this._gizmoDragListener = () => {
            const p = visual.rootObject.position
            const q = visual.rootObject.quaternion
            const pos: Vec3Tuple = [p.x, p.y, p.z]
            const rot: QuatTuple = [q.x, q.y, q.z, q.w]

            if (this._tray.assemblies && assemblyIndex < this._tray.assemblies.length) {
                this._tray.assemblies[assemblyIndex].position = pos
                this._tray.assemblies[assemblyIndex].rotation = rot
            }
            visual.setTransform(pos, rot)
        }
        gizmo.addEventListener("change", this._gizmoDragListener)

        this._gizmoDraggingListener = (event: { value: unknown }) => {
            renderer.currentCameraControls.enabled = !event.value
        }
        gizmo.addEventListener("dragging-changed", this._gizmoDraggingListener)

        this._activeGizmo = gizmo
        this._activeGizmoIndex = assemblyIndex

        window.dispatchEvent(new CustomEvent("ovenResult", {
            detail: { action: "gizmoState", active: true, assemblyIndex, mode },
        }))
    }

    private disableGizmo(): void {
        if (!this._activeGizmo) return

        const renderer = World.sceneRenderer

        this._activeGizmo.detach()
        renderer.scene.remove(this._activeGizmo.getHelper())

        if (this._gizmoDragListener) {
            this._activeGizmo.removeEventListener("change", this._gizmoDragListener)
            this._gizmoDragListener = undefined
        }
        if (this._gizmoDraggingListener) {
            this._activeGizmo.removeEventListener("dragging-changed", this._gizmoDraggingListener as any)
            this._gizmoDraggingListener = undefined
        }

        this._activeGizmo.dispose()
        this._activeGizmo = undefined

        renderer.currentCameraControls.enabled = true

        const prevIndex = this._activeGizmoIndex
        this._activeGizmoIndex = -1

        window.dispatchEvent(new CustomEvent("ovenResult", {
            detail: { action: "gizmoState", active: false, assemblyIndex: prevIndex },
        }))
    }

    /**
     * Before starting a simulation, pull the latest transforms from each
     * visual's rootObject and write them onto the tray assemblies.
     */
    private syncTrayTransforms(): void {
        if (!this._tray.assemblies) return

        for (let i = 0; i < this._tray.assemblies.length; i++) {
            const visual = this._assemblyVisuals[i]
            if (!visual) continue

            this._tray.assemblies[i].position = visual.getPosition()
            this._tray.assemblies[i].rotation = visual.getRotation()
        }
    }

    /**
     * After a reset, restore each visual to its pre-simulation transform
     * stored on the tray.
     */
    private restoreVisualTransforms(): void {
        if (!this._tray.assemblies) return

        for (let i = 0; i < this._tray.assemblies.length; i++) {
            const visual = this._assemblyVisuals[i]
            if (!visual) continue

            const pos = this._tray.assemblies[i].position ?? [0, 0, 0] as Vec3Tuple
            const rot = this._tray.assemblies[i].rotation ?? [0, 0, 0, 1] as QuatTuple
            visual.setTransform(pos, rot)
        }
    }

    private broadcastTrayState(): void {
        const assemblies = (this._tray.assemblies ?? []).map((asm, i) => {
            const visual = this._assemblyVisuals[i]
            const rootNodeId = visual?.parser.rootNode
            const rigidNodes = visual
                ? [...visual.parser.rigidNodes.values()].map(rn => ({
                    nodeId: rn.id,
                    isDynamic: rn.isDynamic,
                    fixed: asm.nodeOverrides?.[rn.id]?.fixed ?? false,
                    isRoot: rn.id === rootNodeId,
                }))
                : []

            const joints = this.extractJointInfo(visual?.parser, asm)

            return {
                index: i,
                name: this._assemblyNames[i] ?? "Unnamed Assembly",
                motors: (asm.motors ?? []).map(m => ({
                    jointGuid: m.jointGuid,
                    mode: m.mode,
                    targetValue: m.targetValue,
                    maxForce: m.maxForce,
                    maxTorque: m.maxTorque,
                })),
                rigidNodes,
                joints,
                initialLinearVelocity: asm.initialLinearVelocity,
                initialAngularVelocity: asm.initialAngularVelocity,
            }
        })

        window.dispatchEvent(new CustomEvent("ovenResult", {
            detail: {
                action: "trayUpdated",
                assemblies,
                environment: { groundEnabled: this._groundEnabled },
            },
        }))
    }

    private extractJointInfo(
        parser: MirabufParser | undefined,
        asm: OvenTrayAssembly,
    ): { jointGuid: string; name: string; motionType: "revolute" | "slider" | "rigid" | "unknown"; hasMotor: boolean }[] {
        if (!parser) return []

        const jointData = parser.assembly.data?.joints
        if (!jointData?.jointInstances || !jointData?.jointDefinitions) return []

        const motorGuids = new Set((asm.motors ?? []).map(m => m.jointGuid))
        const result: { jointGuid: string; name: string; motionType: "revolute" | "slider" | "rigid" | "unknown"; hasMotor: boolean }[] = []

        for (const [guid, inst] of Object.entries(jointData.jointInstances)) {
            if (guid === GROUNDED_JOINT_ID) continue

            const rnA = parser.partToNodeMap.get(inst.parentPart!)
            const rnB = parser.partToNodeMap.get(inst.childPart!)
            if (!rnA || !rnB || rnA.id === rnB.id) continue

            const jDef = jointData.jointDefinitions[inst.jointReference!] as mirabuf.joint.Joint | undefined
            const motionType = jDef?.jointMotionType

            let motionLabel: "revolute" | "slider" | "rigid" | "unknown"
            if (motionType === mirabuf.joint.JointMotion.REVOLUTE) motionLabel = "revolute"
            else if (motionType === mirabuf.joint.JointMotion.SLIDER) motionLabel = "slider"
            else if (motionType === mirabuf.joint.JointMotion.RIGID) motionLabel = "rigid"
            else motionLabel = "unknown"

            const name = jDef?.info?.name ?? inst.info?.name ?? guid.slice(0, 12)

            result.push({ jointGuid: guid, name, motionType: motionLabel, hasMotor: motorGuids.has(guid) })
        }

        return result
    }

    private broadcastEditingState(): void {
        window.dispatchEvent(new CustomEvent("ovenResult", {
            detail: { action: "editingState", locked: this._editingLocked },
        }))
    }

    private loadTrayAndSimulate(): void {
        if (!this._tray.assemblies?.length && !this._tray.bodies.length) {
            console.warn("[Oven] Tray is empty — nothing to simulate")
            this._editingLocked = false
            window.dispatchEvent(new CustomEvent("ovenResult", { detail: { action: "error" } }))
            this.broadcastEditingState()
            return
        }

        this._oven!.loadTray(this._tray)
        this._oven!.setupRecorder(RECORDER_FRAMERATE, RECORDER_MAX_FRAME_BUFFER)
        this._oven!.saveState()
        this._oven!.simulate(SIMULATE_STEPS)
        this._oven!.getBodyStates()
    }

    private flattenRecording(): void {
        this._flatRecording.clear()
        this._totalRecordedFrames = 0

        if (this._recordingChunks.length === 0) return

        const bodyIds = this._recordingChunks[0].bodies.map(b => b.bodyId)
        for (const id of bodyIds) {
            this._flatRecording.set(id, [])
        }

        for (const chunk of this._recordingChunks) {
            for (const body of chunk.bodies) {
                const arr = this._flatRecording.get(body.bodyId)
                if (arr) {
                    arr.push(...body.keyframes)
                }
            }
        }

        this._totalRecordedFrames = this._flatRecording.get(bodyIds[0])?.length ?? 0
    }

    public destroyEnvironment(): void {
        this.disableGizmo()

        if (this._ovenActionHandler) {
            window.removeEventListener("ovenAction", this._ovenActionHandler)
            this._ovenActionHandler = undefined
        }
        if (this._oven) {
            this._oven.destroy()
            this._oven = undefined
        }
        for (const visual of this._assemblyVisuals) {
            visual.removeFromScene(World.sceneRenderer.scene)
        }
        this._assemblyVisuals = []
        this._assemblyNames = []
        this._tray = { bodies: [], joints: [] }

        if (this._ambientLight) World.sceneRenderer.removeObject(this._ambientLight)
        if (this._directionalLight) World.sceneRenderer.removeObject(this._directionalLight)
        if (this._skybox) World.sceneRenderer.removeObject(this._skybox)
        if (this._ground) World.sceneRenderer.removeObject(this._ground)
        this._ambientLight = undefined
        this._directionalLight = undefined
        this._skybox = undefined
        this._ground = undefined
    }
    public updateEnvironment(deltaTime: number): void {
        if (this._skybox) this._skybox.position.copy(World.sceneRenderer.mainCamera.position)

        if (this._ground) {
            let material: THREE.ShaderMaterial;
            if (Array.isArray(this._ground.material))
                material = this._ground.material[0] as THREE.ShaderMaterial;
            else
                material = this._ground.material as THREE.ShaderMaterial;

            const cameraControls = World.sceneRenderer.currentCameraControls as CustomOrbitControls
            const focusPoint = new THREE.Vector3();
            // focusPoint.applyMatrix4(cameraControls.focus);
            material.uniforms['focusPoint'] = { value: focusPoint }
        }
    }
    public updateGraphicsSettings(): void {}
    public getEnvironmentContextData(): ContextData {
        const data: ContextData = { title: "Protoype", items: [] }
        data.items.push({
            name: "Add Prototype",
            type: "modal",
            screen: ImportPrototypeModal,
        })
        return data;
    }
}

export default PrototypeEnvironment;
