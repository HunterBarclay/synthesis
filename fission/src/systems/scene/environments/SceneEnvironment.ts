import { type ContextData } from "@/ui/components/ContextMenuData"

abstract class SceneEnvironment {
    public abstract createEnvironment(): void;
    public abstract destroyEnvironment(): void;
    public abstract updateEnvironment(deltaTime: number): void;
    public abstract updateGraphicsSettings(): void;
    public abstract getEnvironmentContextData(): ContextData;
}

export default SceneEnvironment;