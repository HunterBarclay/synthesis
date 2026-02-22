import * as THREE from "three"

interface CameraFocusProvider {
    loadFocusTransform(focus: THREE.Matrix4): void
}

export default CameraFocusProvider;
