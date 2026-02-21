import World from "@/systems/World";
import SceneEnvironment from "./SceneEnvironment";
import vertexShader from "@/shaders/proto_skybox_vs.glsl"
import fragmentShader from "@/shaders/proto_skybox_fs.glsl"
import * as THREE from "three"
import { MiraType } from "@/mirabuf/MirabufLoader";
import MirabufCachingService from "@/mirabuf/MirabufLoader";
import { createPrototype } from "@/mirabuf/prototype/PrototypeSceneObject";
import { ContextData } from "@/ui/components/ContextMenuData";
import JOLT from "@/util/loading/JoltSyncLoader"

class PrototypeEnvironment extends SceneEnvironment {

    private _directionalLight: THREE.DirectionalLight | undefined
    private _ambientLight: THREE.AmbientLight | undefined
    private _skybox: THREE.Mesh | undefined

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
        const geometry = new THREE.SphereGeometry(250)
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

        World.physicsSystem.setGravity(new JOLT.Vec3(0, 0, 0));

        MirabufCachingService.cacheRemote(
            "/api/mira/robots/Team 2471 (2018)_v7.mira",
            MiraType.ROBOT
        ).then(x => MirabufCachingService.get(x!.hash))
        .then(assembly => assembly && createPrototype(assembly))
        .then(prototypeSceneObject => prototypeSceneObject && World.sceneRenderer.registerSceneObject(prototypeSceneObject))
    }
    public destroyEnvironment(): void {
        if (this._ambientLight) World.sceneRenderer.removeObject(this._ambientLight)
        if (this._directionalLight) World.sceneRenderer.removeObject(this._directionalLight)
        if (this._skybox) World.sceneRenderer.removeObject(this._skybox)
        this._ambientLight = undefined
        this._directionalLight = undefined
        this._skybox = undefined
    }
    public updateEnvironment(deltaTime: number): void {
        if (this._skybox) this._skybox.position.copy(World.sceneRenderer.mainCamera.position)
    }
    public updateGraphicsSettings(): void {}
    public getEnvironmentContextData(): ContextData {
        const data: ContextData = { title: "Protoype", items: [] }
        data.items.push({
            name: "Add Prototype",
            func: () => {
                console.debug("Todo")
            },
        })
        return data;
    }
}

export default PrototypeEnvironment;
