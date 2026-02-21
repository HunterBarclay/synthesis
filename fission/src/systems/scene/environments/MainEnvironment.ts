import SceneEnvironment from "./SceneEnvironment"

import * as THREE from "three"
import { CSM } from "three/examples/jsm/csm/CSM.js"
import autodeskLogo from "@/assets/autodesk_symbol.png"
import World from "@/systems/World"
import PreferencesSystem from "@/systems/preferences/PreferencesSystem"
import fragmentShader from "@/shaders/fragment.glsl"
import vertexShader from "@/shaders/vertex.glsl"
import { GraphicsPreferences } from "@/systems/preferences/PreferenceTypes"
import JOLT from "@/util/loading/JoltSyncLoader"
import { ContextData } from "@/ui/components/ContextMenuData"
import { globalOpenPanel } from "@/ui/components/GlobalUIControls"
import ImportMirabufPanel from "@/ui/panels/mirabuf/ImportMirabufPanel"
import { ConfigurationType } from "@/ui/panels/configuring/assembly-config/ConfigTypes"

const textureLoader = new THREE.TextureLoader()
const GROUND_COLOR = 0xfffef0
const FLOOR_FRICTION = 0.7

class MainEnvironment extends SceneEnvironment {

    private _skybox: THREE.Mesh | undefined
    private _ground: THREE.Mesh | undefined
    private _directionalLight: THREE.DirectionalLight | CSM | undefined
    private _ambientLight: THREE.AmbientLight | undefined

    public createEnvironment(): void {

        const sceneRenderer = World.sceneRenderer;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3)
        sceneRenderer.addObject(ambientLight)

        const groundGeometry = new THREE.BoxGeometry(15, 0.2, 15)

        const logoTexture = textureLoader.load(autodeskLogo)
        logoTexture.wrapS = THREE.ClampToEdgeWrapping
        logoTexture.wrapT = THREE.ClampToEdgeWrapping
        logoTexture.center.set(0.5, 0.5) // Size Adjustment
        logoTexture.repeat.set(2, 2)

        const logoMaterial = new THREE.MeshToonMaterial({
            map: logoTexture,
            color: GROUND_COLOR,
            shadowSide: THREE.DoubleSide,
        })

        this.updateGraphicsSettings()
        if (this._directionalLight instanceof CSM) this._directionalLight.setupMaterial(logoMaterial)

        const solidMaterial = sceneRenderer.createToonMaterial(GROUND_COLOR)

        // Define each face individually
        const materials = [
            solidMaterial,
            solidMaterial,
            logoMaterial, // Logo on top face only
            solidMaterial,
            solidMaterial,
            solidMaterial,
        ]

        this._ground = new THREE.Mesh(groundGeometry, materials)
        this._ground.position.set(0.0, -0.09, 0.0)
        this._ground.receiveShadow = true
        this._ground.castShadow = true
        sceneRenderer.addObject(this._ground)

        // Adding spherical skybox mesh
        const geometry = new THREE.SphereGeometry(1000)
        const material = new THREE.ShaderMaterial({
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            side: THREE.BackSide,
            uniforms: {
                rColor: { value: 1.0 },
                gColor: { value: 1.0 },
                bColor: { value: 1.0 },
            },
        })

        this._skybox = new THREE.Mesh(geometry, material)
        this._skybox.receiveShadow = false
        this._skybox.castShadow = false
        sceneRenderer.addObject(this._skybox)

        const ground = World.physicsSystem.createBox(
            new THREE.Vector3(7.5, 0.1, 7.5),
            undefined,
            new THREE.Vector3(0.0, -0.1, 0.0),
            undefined
        )
        ground.SetFriction(FLOOR_FRICTION)
        World.physicsSystem.addBodyToSystem(ground.GetID(), true);
    }
    public destroyEnvironment(): void {
        if (this._skybox) World.sceneRenderer.removeObject(this._skybox)
        if (this._ground) World.sceneRenderer.removeObject(this._ground)
        if (this._directionalLight instanceof THREE.DirectionalLight) World.sceneRenderer.removeObject(this._directionalLight)
        if (this._directionalLight instanceof CSM) {
            this._directionalLight.dispose()
        }
        if (this._ambientLight) World.sceneRenderer.removeObject(this._ambientLight)
        this._directionalLight = undefined
        this._ambientLight = undefined
        this._skybox = undefined
        this._ground = undefined
    }
    public updateEnvironment(deltaTime: number): void {
        if (this._skybox) this._skybox.position.copy(World.sceneRenderer.mainCamera.position)
    }
    public updateGraphicsSettings(): void {
        if (!this._directionalLight) return;

        const sceneRenderer = World.sceneRenderer;
        
        if (this._directionalLight instanceof THREE.DirectionalLight) {
            World.sceneRenderer.removeObject(this._directionalLight)
        } else if (this._directionalLight instanceof CSM) {
            this._directionalLight.dispose()
            this._directionalLight.remove()
        }

        // setting the shadow map size
        const graphicsSettings = PreferencesSystem.getGraphicsPreferences()
        const shadowMapSize = Math.min(graphicsSettings.shadowMapSize, sceneRenderer.renderer.capabilities.maxTextureSize)

        // setting the light to a basic directional light
        if (!graphicsSettings.fancyShadows) {
            const shadowCamSize = 15

            this._directionalLight = new THREE.DirectionalLight(0xffffff, graphicsSettings.lightIntensity)
            const lightDirection = new THREE.Vector3(1.0, -3.0, -2.0).normalize()
            this._directionalLight.position.copy(lightDirection.clone().multiplyScalar(-20))
            this._directionalLight.castShadow = true
            this._directionalLight.shadow.camera.top = shadowCamSize
            this._directionalLight.shadow.camera.bottom = -shadowCamSize
            this._directionalLight.shadow.camera.left = -shadowCamSize
            this._directionalLight.shadow.camera.right = shadowCamSize
            this._directionalLight.shadow.mapSize = new THREE.Vector2(shadowMapSize, shadowMapSize)
            this._directionalLight.shadow.blurSamples = 16
            this._directionalLight.shadow.bias = 0.0
            this._directionalLight.shadow.normalBias = 0.01
            sceneRenderer.addObject(this._directionalLight)
        } else {
            // setting the light to a cascading shadow map
            this.createCSM(graphicsSettings)

            // setting up all the materials
            this.setupCSMMaterials()
        }
    }

    public createCSM(settings: GraphicsPreferences) {
        this._directionalLight = new CSM({
            parent: World.sceneRenderer.scene,
            camera: World.sceneRenderer.mainCamera,
            cascades: settings.cascades,
            lightDirection: new THREE.Vector3(1.0, -3.0, -2.0).normalize(),
            lightIntensity: settings.lightIntensity,
            shadowMapSize: settings.shadowMapSize,
            mode: "custom",
            maxFar: settings.maxFar,
            shadowBias: -0.00001,
            customSplitsCallback: (cascades: number, near: number, far: number, breaks: number[]) => {
                const blend = 0.7
                for (let i = 1; i < cascades; i++) {
                    const uniformFactor = (near + ((far - near) * i) / cascades) / far
                    const logarithmicFactor = (near * (far / near) ** (i / cascades)) / far
                    const combinedFactor = uniformFactor * (1 - blend) + logarithmicFactor * blend

                    breaks.push(combinedFactor)
                }

                breaks.push(1)
            },
        })
        this._directionalLight.fade = true
    }

    private setupCSMMaterials() {
        if (!this._directionalLight) return;

        World.sceneRenderer.sceneObjects.forEach(child => {
            if (child instanceof THREE.Mesh) {
                if (this._directionalLight instanceof CSM) this._directionalLight.setupMaterial(child.material)
            }
        })
    }
    
    public getEnvironmentContextData(): ContextData {
        const data: ContextData = { title: "The Scene", items: [] }
        data.items.push({
            name: "Add",
            func: () => {
                globalOpenPanel(ImportMirabufPanel, {
                    configurationType: "ROBOTS" as ConfigurationType,
                })
            },
        })
        return data;
    }
}

export default MainEnvironment;
