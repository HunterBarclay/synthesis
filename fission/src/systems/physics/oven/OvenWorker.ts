import {
    OvenMessageType,
    type OvenRequest,
    type OvenResponse,
    type OvenConfigureMessage,
    type OvenLoadTrayMessage,
    type OvenSimulateMessage,
    type OvenSaveStateMessage,
    type OvenResetStateMessage,
    type OvenSetupRecorderMessage,
} from "./OvenProtocol"
import OvenSystem from "./OvenSystem"

let ovenSystem: OvenSystem | undefined

function respond(msg: OvenResponse): void {
    self.postMessage(msg)
}

function success(requestId?: number): void {
    respond({ messageType: OvenMessageType.Result, requestId, success: true })
}

function fail(requestId: number | undefined, error: string): void {
    respond({ messageType: OvenMessageType.Result, requestId, success: false, error })
}

function handleMessage(data: OvenRequest): void {
    const { requestId } = data

    try {
        switch (data.messageType) {
            case OvenMessageType.Init: {
                if (ovenSystem) {
                    ovenSystem.destroy()
                }
                ovenSystem = new OvenSystem()
                ovenSystem.setRecordingFlushCallback((bodies, firstStep, lastStep) => {
                    respond({
                        messageType: OvenMessageType.RecordingData,
                        bodies,
                        firstStep,
                        lastStep,
                    })
                })
                ovenSystem.setProgressCallback((completedSteps, totalSteps) => {
                    respond({
                        messageType: OvenMessageType.SimulationProgress,
                        completedSteps,
                        totalSteps,
                    })
                })
                respond({ messageType: OvenMessageType.Ready, requestId })
                return
            }

            case OvenMessageType.Configure: {
                requireSystem()
                const msg = data as OvenConfigureMessage
                ovenSystem!.configure(msg.gravity, msg.timestep, msg.substeps, msg.progressInterval)
                success(requestId)
                return
            }

            case OvenMessageType.LoadTray: {
                requireSystem()
                const msg = data as OvenLoadTrayMessage
                ovenSystem!.loadTray(msg.tray)
                success(requestId)
                return
            }

            case OvenMessageType.Simulate: {
                requireSystem()
                const msg = data as OvenSimulateMessage
                ovenSystem!.simulate(msg.steps)
                success(requestId)
                return
            }

            case OvenMessageType.SaveState: {
                requireSystem()
                const msg = data as OvenSaveStateMessage
                ovenSystem!.saveState(msg.slotName)
                success(requestId)
                return
            }

            case OvenMessageType.ResetState: {
                requireSystem()
                const msg = data as OvenResetStateMessage
                ovenSystem!.resetState(msg.slotName)
                success(requestId)
                return
            }

            case OvenMessageType.GetBodyStates: {
                requireSystem()
                const bodies = ovenSystem!.getBodyStates()
                respond({ messageType: OvenMessageType.BodyStates, requestId, bodies })
                return
            }

            case OvenMessageType.SetupRecorder: {
                requireSystem()
                const msg = data as OvenSetupRecorderMessage
                ovenSystem!.setupRecorder(msg.framerate, msg.maxFrameBuffer)
                success(requestId)
                return
            }

            default:
                fail(requestId, `Unknown message type: ${(data as IOvenMessageFallback).messageType}`)
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        fail(requestId, message)
    }
}

function requireSystem(): void {
    if (!ovenSystem) {
        throw new Error("OvenSystem not initialized. Send Init message first.")
    }
}

interface IOvenMessageFallback {
    messageType: string
}

self.addEventListener("message", (e: MessageEvent) => {
    if (!e.data || !e.data.messageType) return
    handleMessage(e.data as OvenRequest)
})

self.postMessage({ messageType: OvenMessageType.Loaded })
