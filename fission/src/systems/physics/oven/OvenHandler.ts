import OvenWorker from "@/systems/physics/oven/OvenWorker?worker"
import {
    OvenMessageType,
    type OvenTray,
    type OvenBodyState,
    type OvenRecordingBody,
    type OvenRequest,
    type OvenResponse,
    type Vec3Tuple,
} from "./OvenProtocol"

export interface OvenRecordingChunk {
    bodies: OvenRecordingBody[]
    firstStep: number
    lastStep: number
}

class OvenHandler {
    private _worker: Worker | undefined
    private _ready = false

    public onReady: (() => void) | undefined
    public onError: ((error: string) => void) | undefined
    public onBodyStates: ((bodies: OvenBodyState[]) => void) | undefined
    public onRecordingData: ((chunk: OvenRecordingChunk) => void) | undefined
    public onProgress: ((completedSteps: number, totalSteps: number) => void) | undefined

    public get ready(): boolean { return this._ready }

    public init(): void {
        this.destroy()

        this._ready = false
        this._worker = new OvenWorker()

        this._worker.addEventListener("message", (e: MessageEvent<OvenResponse>) => {
            this.handleResponse(e.data)
        })

        this._worker.addEventListener("error", (e: ErrorEvent) => {
            console.error("[OvenHandler] Worker error:", e.message, e)
            this.onError?.(e.message)
        })
    }

    public destroy(): void {
        if (this._worker) {
            this._worker.terminate()
            this._worker = undefined
        }
        this._ready = false
    }

    public configure(options: { gravity?: Vec3Tuple; timestep?: number; substeps?: number; progressInterval?: number }): void {
        this.send({
            messageType: OvenMessageType.Configure,
            gravity: options.gravity,
            timestep: options.timestep,
            substeps: options.substeps,
            progressInterval: options.progressInterval,
        })
    }

    public loadTray(tray: OvenTray): void {
        this.send({ messageType: OvenMessageType.LoadTray, tray })
    }

    public simulate(steps: number): void {
        this.send({ messageType: OvenMessageType.Simulate, steps })
    }

    public saveState(slotName?: string): void {
        this.send({ messageType: OvenMessageType.SaveState, slotName })
    }

    public resetState(slotName?: string): void {
        this.send({ messageType: OvenMessageType.ResetState, slotName })
    }

    public getBodyStates(): void {
        this.send({ messageType: OvenMessageType.GetBodyStates })
    }

    public setupRecorder(framerate: number, maxFrameBuffer: number): void {
        this.send({ messageType: OvenMessageType.SetupRecorder, framerate, maxFrameBuffer })
    }

    private send(msg: OvenRequest): void {
        this._worker?.postMessage(msg)
    }

    private handleResponse(msg: OvenResponse): void {
        switch (msg.messageType) {
            case OvenMessageType.Loaded:
                this.send({ messageType: OvenMessageType.Init })
                break

            case OvenMessageType.Ready:
                this._ready = true
                this.onReady?.()
                break

            case OvenMessageType.Result:
                if (!msg.success) {
                    console.error(`[OvenHandler] ${msg.error}`)
                    this.onError?.(msg.error ?? "Unknown error")
                }
                break

            case OvenMessageType.BodyStates:
                this.onBodyStates?.(msg.bodies)
                break

            case OvenMessageType.RecordingData:
                this.onRecordingData?.({
                    bodies: msg.bodies,
                    firstStep: msg.firstStep,
                    lastStep: msg.lastStep,
                })
                break

            case OvenMessageType.SimulationProgress:
                this.onProgress?.(msg.completedSteps, msg.totalSteps)
                break

            case OvenMessageType.Error:
                console.error(`[OvenHandler] ${msg.error}`)
                this.onError?.(msg.error)
                break
        }
    }
}

export default OvenHandler
