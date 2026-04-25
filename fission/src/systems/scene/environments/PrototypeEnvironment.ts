import World from "@/systems/World";
import SceneEnvironment from "./SceneEnvironment";
import skyboxVS from "@/shaders/proto_skybox_vs.glsl"
import skyboxFS from "@/shaders/proto_skybox_fs.glsl"
import groundVS from "@/shaders/box_cross_ground_vs.glsl"
import groundFS from "@/shaders/box_cross_ground_fs.glsl"
import * as THREE from "three"
import { MiraType } from "@/mirabuf/MirabufLoader";
import MirabufCachingService from "@/mirabuf/MirabufLoader";
import { createPrototype } from "@/mirabuf/prototype/PrototypeSceneObject";
import { ContextData } from "@/ui/components/ContextMenuData";
import JOLT from "@/util/loading/JoltSyncLoader"
import PreferencesSystem from "@/systems/preferences/PreferencesSystem";
import { CustomOrbitControls } from "../camera/CameraControls";
import ImportPrototypeModal from "@/ui/modals/mirabuf/ImportPrototypeModal";
import OvenWorker from "@/systems/physics/oven/OvenWorker?worker"
import { OvenMessageType, type OvenBodyKeyframe, type OvenBodyState, type OvenRecordingBody, type OvenRequest, type OvenResponse } from "@/systems/physics/oven/OvenProtocol"

interface OvenBoxDef {
    bodyId: string
    halfExtents: [number, number, number]
    position: [number, number, number]
    color: number
    mass: number
    fixed?: boolean
}

const OVEN_BOXES: OvenBoxDef[] = [
    { bodyId: "boxA", halfExtents: [0.5, 0.5, 0.5], position: [0.0, 0.0, 0.0], color: 0x4488ff, mass: 1.0, fixed: true },
    { bodyId: "boxB", halfExtents: [1.0, 0.5, 0.5], position: [1.5, 1.0, 0.0], color: 0xff6644, mass: 1.0 },
]

const OVEN_TIMESTEP = 1.0 / 240.0
const SIMULATE_SECONDS = 10
const SIMULATE_STEPS = Math.round(SIMULATE_SECONDS / OVEN_TIMESTEP)

const RECORDER_FRAMERATE = 60
const RECORDER_MAX_FRAME_BUFFER = 300

class PrototypeEnvironment extends SceneEnvironment {

    private _directionalLight: THREE.DirectionalLight | undefined
    private _ambientLight: THREE.AmbientLight | undefined
    private _skybox: THREE.Mesh | undefined
    private _ground: THREE.Mesh | undefined
    private _ovenWorker: Worker | undefined

    private _boxMeshes: Map<string, THREE.Mesh> = new Map()
    private _ovenActionHandler: ((e: Event) => void) | undefined
    private _recordingChunks: { bodies: OvenRecordingBody[], firstStep: number, lastStep: number }[] = []
    private _flatRecording: Map<string, OvenBodyKeyframe[]> = new Map()
    private _totalRecordedFrames: number = 0

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

        // Adding spherical skybox mesh
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

        // Adding ground mesh
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

        // MirabufCachingService.cacheRemote(
        //     "/api/mira/robots/Team 2471 (2018)_v7.mira",
        //     MiraType.ROBOT
        // ).then(x => MirabufCachingService.get(x!.hash))
        // .then(assembly => assembly && createPrototype(assembly))
        // .then(prototypeSceneObject => prototypeSceneObject && World.sceneRenderer.registerSceneObject(prototypeSceneObject))

        World.dragModeSystem.enabled = true;

        PreferencesSystem.setGlobalPreference('ShowViewCube', false);

        this._ovenWorker = new OvenWorker()
        this._ovenWorker.addEventListener("message", (e: MessageEvent<OvenResponse>) => {
            this.handleOvenResponse(e.data)
        })
        this._ovenWorker.addEventListener("error", (e: ErrorEvent) => {
            console.error("[Oven] Worker error:", e.message, e)
        })

        this._ovenActionHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail
            if (detail?.action === "simulate") {
                this._recordingChunks = []
                this._flatRecording.clear()
                this._totalRecordedFrames = 0
                this.sendOven({ messageType: OvenMessageType.SaveState })
                this.sendOven({ messageType: OvenMessageType.Simulate, steps: SIMULATE_STEPS })
                this.sendOven({ messageType: OvenMessageType.GetBodyStates })
            } else if (detail?.action === "reset") {
                this._recordingChunks = []
                this._flatRecording.clear()
                this._totalRecordedFrames = 0
                this.sendOven({ messageType: OvenMessageType.ResetState })
                this.sendOven({ messageType: OvenMessageType.GetBodyStates })
            } else if (detail?.action === "scrub") {
                this.scrubToNormalized(detail.t as number)
            }
        }
        window.addEventListener("ovenAction", this._ovenActionHandler)

    }

    private sendOven(msg: OvenRequest): void {
        this._ovenWorker?.postMessage(msg)
    }

    private handleOvenResponse(msg: OvenResponse): void {
        switch (msg.messageType) {
            case OvenMessageType.Loaded:
                this.sendOven({ messageType: OvenMessageType.Init })
                break
            case OvenMessageType.Ready:
                this.setupOvenScene()
                break
            case OvenMessageType.Result:
                if (!msg.success) {
                    console.error(`[Oven] Error: ${msg.error}`)
                    window.dispatchEvent(new CustomEvent("ovenResult", { detail: { action: "error" } }))
                }
                break
            case OvenMessageType.BodyStates:
                this.applyBodyStates(msg.bodies)
                this.flattenRecording()
                window.dispatchEvent(new CustomEvent("ovenResult", {
                    detail: { action: "simulateDone", totalFrames: this._totalRecordedFrames },
                }))
                break
            case OvenMessageType.RecordingData:
                this._recordingChunks.push({
                    bodies: msg.bodies,
                    firstStep: msg.firstStep,
                    lastStep: msg.lastStep,
                })
                console.log(`[Oven] Recording chunk: steps ${msg.firstStep}–${msg.lastStep} (${msg.bodies[0]?.keyframes.length ?? 0} frames)`)
                break
        }
    }

    private setupOvenScene(): void {
        for (const def of OVEN_BOXES) {
            this.sendOven({
                messageType: OvenMessageType.AddBody,
                bodyId: def.bodyId,
                halfExtents: def.halfExtents,
                position: def.position,
                rotation: [0, 0, 0, 1],
                mass: def.mass,
                fixed: def.fixed,
            })
            this.createBoxMesh(def)
        }

        this.sendOven({
            messageType: OvenMessageType.AddJoint,
            jointId: "hingeAB",
            bodyIdA: "boxA",
            bodyIdB: "boxB",
            jointType: "hinge",
            anchor: [0.5, 0.5, 0.0],
            axis: [0, 0, 1],
        })

        this.sendOven({ messageType: OvenMessageType.SaveState })
        this.sendOven({
            messageType: OvenMessageType.SetupRecorder,
            framerate: RECORDER_FRAMERATE,
            maxFrameBuffer: RECORDER_MAX_FRAME_BUFFER,
        })
    }

    private createBoxMesh(def: OvenBoxDef): void {
        const [hx, hy, hz] = def.halfExtents
        const geometry = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2)
        const material = new THREE.MeshStandardMaterial({
            color: def.color,
            roughness: 0.4,
            metalness: 0.1,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(...def.position)
        mesh.castShadow = true
        mesh.receiveShadow = true

        World.sceneRenderer.addObject(mesh)
        this._boxMeshes.set(def.bodyId, mesh)
    }

    private applyBodyStates(bodies: OvenBodyState[]): void {
        for (const state of bodies) {
            const mesh = this._boxMeshes.get(state.bodyId)
            if (!mesh) continue

            mesh.position.set(...state.position)
            mesh.quaternion.set(...state.rotation)
        }
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

    private scrubToNormalized(t: number): void {
        if (this._totalRecordedFrames < 2) return

        const clamped = Math.max(0, Math.min(1, t))
        const floatIndex = clamped * (this._totalRecordedFrames - 1)
        const low = Math.floor(floatIndex)
        const high = Math.min(low + 1, this._totalRecordedFrames - 1)
        const alpha = floatIndex - low

        const tmpPosA = new THREE.Vector3()
        const tmpPosB = new THREE.Vector3()
        const tmpQuatA = new THREE.Quaternion()
        const tmpQuatB = new THREE.Quaternion()

        for (const [bodyId, keyframes] of this._flatRecording) {
            const mesh = this._boxMeshes.get(bodyId)
            if (!mesh) continue

            const kfA = keyframes[low]
            const kfB = keyframes[high]

            tmpPosA.set(...kfA.position)
            tmpPosB.set(...kfB.position)
            mesh.position.lerpVectors(tmpPosA, tmpPosB, alpha)

            tmpQuatA.set(...kfA.rotation)
            tmpQuatB.set(...kfB.rotation)
            mesh.quaternion.slerpQuaternions(tmpQuatA, tmpQuatB, alpha)
        }
    }
    public destroyEnvironment(): void {
        if (this._ovenActionHandler) {
            window.removeEventListener("ovenAction", this._ovenActionHandler)
            this._ovenActionHandler = undefined
        }
        if (this._ovenWorker) {
            this._ovenWorker.terminate()
            this._ovenWorker = undefined
        }
        for (const [, mesh] of this._boxMeshes) {
            World.sceneRenderer.removeObject(mesh)
            mesh.geometry.dispose()
            ;(mesh.material as THREE.MeshStandardMaterial).dispose()
        }
        this._boxMeshes.clear()

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
