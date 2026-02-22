import type Jolt from "@azaleacolburn/jolt-physics"
import { EdgeDetectionMode, EffectComposer, EffectPass, RenderPass, SMAAEffect } from "postprocessing"
import * as THREE from "three"
import { CSM } from "three/examples/jsm/csm/CSM.js"
import { MiraType } from "@/mirabuf/MirabufLoader"
import MirabufSceneObject, { type RigidNodeAssociate } from "@/mirabuf/MirabufSceneObject"
import { type CameraControls, type CameraControlsType, CustomOrbitControls } from "@/systems/scene/camera/CameraControls"
import { type ContextData, ContextSupplierEvent } from "@/ui/components/ContextMenuData"
import { globalOpenPanel } from "@/ui/components/GlobalUIControls"
import { type PixelSpaceCoord, SceneOverlayEvent, SceneOverlayEventKey } from "@/ui/components/SceneOverlayEvents"
import { TouchControlsEvent, TouchControlsEventKeys } from "@/ui/components/TouchControls"
import type { ConfigurationType } from "@/ui/panels/configuring/assembly-config/ConfigTypes"
import ImportMirabufPanel from "@/ui/panels/mirabuf/ImportMirabufPanel"
import { convertThreeVector3ToJoltVec3 } from "@/util/TypeConversions"
import PreferencesSystem from "../preferences/PreferencesSystem"
import type { GraphicsPreferences } from "../preferences/PreferenceTypes"
import World from "../World"
import WorldSystem from "../WorldSystem"
import GizmoSceneObject from "./GizmoSceneObject"
import type SceneObject from "./SceneObject"
import ScreenInteractionHandler, { type InteractionEnd } from "./ScreenInteractionHandler"
import type { LocalSceneObjectId, RemoteSceneObjectId } from "@/systems/multiplayer/types.ts"
import SceneEnvironment from "./environments/SceneEnvironment"

const CLEAR_COLOR = 0x121212

const STANDARD_ASPECT = 16.0 / 9.0
export const STANDARD_CAMERA_FOV_X = 60.0
export const STANDARD_CAMERA_FOV_Y = STANDARD_CAMERA_FOV_X / STANDARD_ASPECT

let nextSceneObjectId = 1

class SceneRenderer extends WorldSystem {
    private _mainCamera: THREE.PerspectiveCamera
    private _scene: THREE.Scene
    private _renderer: THREE.WebGLRenderer
    private _composer: EffectComposer
    private _environment: SceneEnvironment | undefined

    private _sceneObjects: Map<number, SceneObject>
    private _gizmosOnMirabuf: Map<number, GizmoSceneObject> // maps of all the gizmos that are attached to a mirabuf scene object

    private _cameraControls: CameraControls

    private _isPlacingAssembly: boolean = false

    private _screenInteractionHandler: ScreenInteractionHandler

    public get sceneObjects() {
        return this._sceneObjects
    }
    public set sceneObjects(objects: Map<number, SceneObject>) {
        this._sceneObjects = objects
    }

    public filterSceneObjects<T extends SceneObject>(predicate: (obj: SceneObject) => obj is T): T[] {
        return [...this._sceneObjects.values()].filter(predicate)
    }

    public readonly mirabufSceneObjects = {
        getAll: () => this.filterSceneObjects<MirabufSceneObject>((obj: SceneObject): obj is MirabufSceneObject => obj instanceof MirabufSceneObject),
        findWhere: (predicate: (obj: MirabufSceneObject) => boolean) =>
            this.mirabufSceneObjects.getAll().find(predicate),
        getField: () => this.mirabufSceneObjects.findWhere(obj => obj.miraType == MiraType.FIELD),
        getRobots: () => this.mirabufSceneObjects.getAll().filter(obj => obj.miraType == MiraType.ROBOT),
    } as const

    public get mainCamera() {
        return this._mainCamera
    }

    public get scene() {
        return this._scene
    }

    public get renderer(): THREE.WebGLRenderer {
        return this._renderer
    }

    public get isPlacingAssembly() {
        return this._isPlacingAssembly
    }

    public set isPlacingAssembly(value: boolean) {
        new TouchControlsEvent(TouchControlsEventKeys.PLACE_BUTTON, value)
        this._isPlacingAssembly = value
    }

    public get currentCameraControls(): CameraControls {
        return this._cameraControls
    }

    public get screenInteractionHandler(): ScreenInteractionHandler {
        return this._screenInteractionHandler
    }

    /**
     * Collection that maps Mirabuf objects to active GizmoSceneObjects
     */
    public get gizmosOnMirabuf() {
        return this._gizmosOnMirabuf
    }

    public constructor() {
        super()

        this._sceneObjects = new Map()
        this._gizmosOnMirabuf = new Map()

        const aspect = window.innerWidth / window.innerHeight
        this._mainCamera = new THREE.PerspectiveCamera(STANDARD_CAMERA_FOV_Y, aspect, 0.1, 1000)
        this._mainCamera.position.set(-2.5, 2, 2.5)

        this._scene = new THREE.Scene()

        this._renderer = new THREE.WebGLRenderer({
            powerPreference: "high-performance",
            antialias: false,
            stencil: false,
            depth: !PreferencesSystem.getGraphicsPreferences().antiAliasing,
        })
        this._renderer.setClearColor(CLEAR_COLOR)
        this._renderer.setPixelRatio(window.devicePixelRatio)
        this._renderer.shadowMap.enabled = true
        this._renderer.shadowMap.type = THREE.PCFSoftShadowMap
        this._renderer.setSize(window.innerWidth, window.innerHeight)

        // POST PROCESSING: https://github.com/pmndrs/postprocessing
        this._composer = new EffectComposer(this._renderer)
        this._composer.addPass(new RenderPass(this._scene, this._mainCamera))

        // if (PreferencesSystem.getGraphicsPreferences().antiAliasing) {
        //     const antiAliasEffect = new SMAAEffect({
        //         edgeDetectionMode: EdgeDetectionMode.COLOR,
        //     })
        //     const antiAliasPass = new EffectPass(this._mainCamera, antiAliasEffect)
        //     this._composer.addPass(antiAliasPass)
        // }

        const antiAliasEffect = new SMAAEffect({
            edgeDetectionMode: EdgeDetectionMode.COLOR,
        })
        const antiAliasPass = new EffectPass(this._mainCamera, antiAliasEffect)
        this._composer.addPass(antiAliasPass)

        // Orbit controls
        this._screenInteractionHandler = new ScreenInteractionHandler(this._renderer.domElement)
        this._screenInteractionHandler.contextMenu = e => this.onContextMenu(e)

        this._cameraControls = new CustomOrbitControls(this._mainCamera, this._screenInteractionHandler)
    }

    public setCameraControls(controlsType: CameraControlsType) {
        this._cameraControls.dispose()
        switch (controlsType) {
            case "Orbit":
                this._cameraControls = new CustomOrbitControls(this._mainCamera, this._screenInteractionHandler)
                break
        }
    }

    public updateCanvasSize() {
        const width = window.innerWidth
        const height = window.innerHeight

        // Update Camera
        this._mainCamera.aspect = height > 0 ? width / height : 1.0
        if (this._mainCamera.aspect < STANDARD_ASPECT) {
            this._mainCamera.fov = STANDARD_CAMERA_FOV_Y
        } else {
            this._mainCamera.fov = STANDARD_CAMERA_FOV_X / this._mainCamera.aspect
        }
        this._mainCamera.updateProjectionMatrix()

        // Update Renderer
        this._renderer.setSize(width, height, true)
        this._composer.setSize(width, height)
        this._renderer.setPixelRatio(window.devicePixelRatio)
    }

    /** Function to disable or enable the antiAliasingPass */
    public update(deltaT: number): void {
        this._sceneObjects.forEach(obj => {
            obj.update()
        })

        this._mainCamera.updateMatrixWorld()

        // updating the CSM light if it is enabled
        // TODO: Fix
        // if (this._light instanceof CSM) this._light.update()

        if (this._environment) this._environment.updateEnvironment(deltaT)

        // Update the tags each frame if they are enabled in preferences
        if (PreferencesSystem.getGlobalPreference("RenderSceneTags")) new SceneOverlayEvent(SceneOverlayEventKey.UPDATE)

        this._screenInteractionHandler.update(deltaT)
        this._cameraControls.update(deltaT)

        this._composer.render(deltaT)
        // this._renderer.render(this._scene, this._mainCamera)
    }

    public destroy(): void {
        this.removeAllSceneObjects()
        this._screenInteractionHandler.dispose()
    }

    /**
     * Changes the quality of lighting between cascading shadows and directional lights
     */
    public updateGraphicsSettings(): void {
        if (this._environment) this._environment.updateGraphicsSettings()
    }

    /** Sets the light intensity for both directional light and csm */
    public setLightIntensity(intensity: number) {
        // TODO: Fix
        // if (this._light instanceof THREE.DirectionalLight) {
        //     this._light.intensity = intensity
        // } else if (this._light instanceof CSM) {
        //     this._light.dispose()
        //     this._light.remove()

        //     this.createCSM({
        //         ...PreferencesSystem.getGraphicsPreferences(),
        //         lightIntensity: intensity,
        //     })
        //     this.setupCSMMaterials()
        // }
    }

    /** Changes the settings of the cascading shadows from the Quality Settings Panel */
    public changeCSMSettings(settings: GraphicsPreferences) {
        // TODO: Fix
        // if (!(this._light instanceof CSM)) return

        // this._light.dispose()
        // this._light.remove()

        // this.createCSM(settings)
        // this.setupCSMMaterials()
    }

    public registerSceneObject<T extends SceneObject>(obj: T, idOverride?: number): LocalSceneObjectId {
        const id = idOverride ?? nextSceneObjectId++
        if (nextSceneObjectId <= id) {
            nextSceneObjectId = id + 1
        }
        if (this._sceneObjects.has(id)) {
            console.error("Trying to add with existing ID!", obj, idOverride)
            return -1 as LocalSceneObjectId
        }
        obj.id = id
        this._sceneObjects.set(id, obj)
        obj.setup()
        return id as LocalSceneObjectId
    }

    /** Registers gizmos that are attached to a parent mirabufsceneobject  */
    public registerGizmoSceneObject(obj: GizmoSceneObject): number {
        if (obj.hasParent()) this._gizmosOnMirabuf.set(obj.parentObjectId!, obj)
        return this.registerSceneObject(obj)
    }

    public removeAllSceneObjects() {
        this._sceneObjects.forEach(obj => obj.dispose())
        this._gizmosOnMirabuf.clear()
        this._sceneObjects.clear()
    }

    public removeSceneObject(id: number) {
        const obj = this._sceneObjects.get(id)

        // If the object is a mirabuf object, remove the gizmo as well
        if (obj instanceof MirabufSceneObject) {
            const objGizmo = this._gizmosOnMirabuf.get(id)
            if (this._gizmosOnMirabuf.delete(id)) objGizmo!.dispose()
            World?.multiplayerSystem?.broadcast({
                type: "deleteObject",
                data: id as RemoteSceneObjectId,
            })
        } else if (obj instanceof GizmoSceneObject && obj.hasParent()) {
            this._gizmosOnMirabuf.delete(obj.parentObjectId!)
        }

        if (this._sceneObjects.delete(id)) {
            obj!.dispose()
        }
    }

    public removeAllFields() {
        for (const [id, obj] of this._sceneObjects) {
            if (obj instanceof MirabufSceneObject && obj.miraType == MiraType.FIELD) {
                this.removeSceneObject(id)
            }
        }
    }

    public createSphere(radius: number, material?: THREE.Material | undefined): THREE.Mesh {
        const geo = new THREE.SphereGeometry(radius)
        if (material) {
            // TODO: Fix
            // if (this._light instanceof CSM) this._light.setupMaterial(material)
            return new THREE.Mesh(geo, material)
        } else {
            return new THREE.Mesh(geo, this.createToonMaterial())
        }
    }

    public createBox(halfExtent: Jolt.Vec3, material?: THREE.Material | undefined): THREE.Mesh {
        const geo = new THREE.BoxGeometry(halfExtent.GetX(), halfExtent.GetY(), halfExtent.GetZ())
        if (material) {
            return new THREE.Mesh(geo, material)
        } else {
            return new THREE.Mesh(geo, this.createToonMaterial())
        }
    }

    public createToonMaterial(color: THREE.ColorRepresentation = 0xff00aa, steps: number = 5): THREE.MeshToonMaterial {
        const format = THREE.RedFormat
        const colors = new Uint8Array(steps)
        for (let c = 0; c < colors.length; c++) {
            colors[c] = 128 + (c / colors.length) * 128
        }
        const gradientMap = new THREE.DataTexture(colors, colors.length, 1, format)
        gradientMap.needsUpdate = true
        const material = new THREE.MeshToonMaterial({
            color: color,
            shadowSide: THREE.DoubleSide,
            gradientMap: gradientMap,
        })
        // TODO: Fix
        // if (this._light instanceof CSM) this._light.setupMaterial(material)
        return material
    }

    /**
     * Convert pixel coordinates to a world space vector
     *
     * @param mouseX X pixel position of the mouse (MouseEvent.clientX)
     * @param mouseY Y pixel position of the mouse (MouseEvent.clientY)
     * @param z Travel from the near to far plane of the camera frustum. Default is 0.5, range is [0.0, 1.0]
     * @returns World space point within the frustum given the parameters.
     */
    public pixelToWorldSpace(mouseX: number, mouseY: number, z: number = 0.5): THREE.Vector3 {
        const screenSpace = new THREE.Vector3(
            (mouseX / window.innerWidth) * 2 - 1,
            ((window.innerHeight - mouseY) / window.innerHeight) * 2 - 1,
            Math.min(1.0, Math.max(0.0, z))
        )

        return screenSpace.unproject(this.mainCamera)
    }

    /**
     * Convert world space coordinates to screen space coordinates
     *
     * @param world World space coordinates
     * @returns Pixel space coordinates
     */
    public worldToPixelSpace(world: THREE.Vector3): PixelSpaceCoord {
        this._mainCamera.updateMatrixWorld()
        const screenSpace = world.project(this._mainCamera)
        return [(window.innerWidth * (screenSpace.x + 1.0)) / 2.0, (window.innerHeight * (1.0 - screenSpace.y)) / 2.0]
    }

    /**
     * TODO: remove
     * Updates the skybox colors based on the current theme

     * @param currentTheme: current theme from ThemeContext.useTheme()
     */
    // public updateSkyboxColors(currentTheme: Theme) {
    //     if (!this._skybox) return
    //     if (this._skybox.material instanceof THREE.ShaderMaterial) {
    //         this._skybox.material.uniforms.rColor.value = currentTheme["Background"]["color"]["r"]
    //         this._skybox.material.uniforms.gColor.value = currentTheme["Background"]["color"]["g"]
    //         this._skybox.material.uniforms.bColor.value = currentTheme["Background"]["color"]["b"]
    //     }
    // }

    /** returns whether any gizmos are being currently dragged */
    public isAnyGizmoDragging(): boolean {
        return [...this._gizmosOnMirabuf.values()].some(obj => obj.gizmo.dragging)
    }

    /**
     * Adding object to scene
     *
     * @param obj Object to add
     */
    public addObject(obj: THREE.Object3D) {
        this._scene.add(obj)
    }

    /**
     * Removing object from scene
     *
     * @param obj Object to remove
     */
    public removeObject(obj: THREE.Object3D) {
        this._scene.remove(obj)
    }

    /**
     * Sets up the threejs material for cascading shadows if the CSM is enabled
     *
     * @param material
     */
    public setupMaterial(material: THREE.Material) {
        // TODO: Fix
        // if (this._light instanceof CSM) this._light.setupMaterial(material)
    }

    /**
     * Context Menu handler for the scene canvas.
     *
     * @param e Mouse event data.
     */
    public onContextMenu(e: InteractionEnd) {
        // Cast ray into physics scene.
        const origin = this.mainCamera.position

        const worldSpace = this.pixelToWorldSpace(e.position[0], e.position[1])
        const dir = worldSpace.sub(origin).normalize().multiplyScalar(40.0)

        const res = World.physicsSystem.rayCast(
            convertThreeVector3ToJoltVec3(origin),
            convertThreeVector3ToJoltVec3(dir)
        )

        // Use any associations to determine ContextData.
        let miraSupplierData: ContextData | undefined
        if (res) {
            const assoc = World.physicsSystem.getBodyAssociation(res.data.mBodyID) as RigidNodeAssociate
            const sceneObject = assoc?.sceneObject
            if (sceneObject) {
                if (
                    !World.multiplayerSystem ||
                    (sceneObject.miraType === MiraType.ROBOT &&
                        World.multiplayerSystem
                            ?.getOwnRobots()
                            .map(obj => obj.id)
                            .includes(sceneObject.id))
                ) {
                    miraSupplierData = assoc.sceneObject.getSupplierData()
                }
            }
        }
        // All else fails, present default options.
        if (!miraSupplierData) {
            miraSupplierData = this._environment?.getEnvironmentContextData() ?? { title: "The Scene", items: [] }
        }

        ContextSupplierEvent.dispatch(miraSupplierData, e.position)
    }

    public setEnvironment(environment: SceneEnvironment) {
        if (this._environment) this._environment.destroyEnvironment()
        this._environment = environment
        this._environment.createEnvironment()
    }
}

export default SceneRenderer
