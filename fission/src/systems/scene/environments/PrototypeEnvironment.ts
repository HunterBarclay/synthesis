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

class PrototypeEnvironment extends SceneEnvironment {

    private _directionalLight: THREE.DirectionalLight | undefined
    private _ambientLight: THREE.AmbientLight | undefined
    private _skybox: THREE.Mesh | undefined
    private _ground: THREE.Mesh | undefined

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
    }
    public destroyEnvironment(): void {
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
