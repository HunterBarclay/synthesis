export enum OvenMessageType {
    Init = "init",
    Configure = "configure",
    LoadTray = "loadTray",
    Simulate = "simulate",
    SaveState = "saveState",
    ResetState = "resetState",
    GetBodyStates = "getBodyStates",
    SetupRecorder = "setupRecorder",

    Loaded = "loaded",
    Ready = "ready",
    Result = "result",
    Error = "error",
    BodyStates = "bodyStates",
    RecordingData = "recordingData",
    SimulationProgress = "simulationProgress",
}

export type Vec3Tuple = [number, number, number]
export type QuatTuple = [number, number, number, number]

export type OvenJointType = "fixed" | "hinge" | "slider"

export interface OvenTrayBody {
    bodyId: string
    halfExtents: Vec3Tuple
    position: Vec3Tuple
    rotation: QuatTuple
    mass?: number
    fixed?: boolean
    friction?: number
    restitution?: number
}

export interface OvenTrayJoint {
    jointId: string
    bodyIdA: string
    bodyIdB: string
    jointType: OvenJointType
    anchor: Vec3Tuple
    axis?: Vec3Tuple
    limitsMin?: number
    limitsMax?: number
}

export type OvenMotorMode = "velocity" | "position"

export interface OvenJointMotor {
    jointGuid: string
    mode: OvenMotorMode
    targetValue: number
    maxForce?: number
    maxTorque?: number
}

export interface OvenNodeOverride {
    fixed?: boolean
}

export interface OvenTrayAssembly {
    assemblyData: Uint8Array
    motors?: OvenJointMotor[]
    nodeOverrides?: Record<string, OvenNodeOverride>
    position?: Vec3Tuple
    rotation?: QuatTuple
}

export interface OvenTray {
    bodies: OvenTrayBody[]
    joints: OvenTrayJoint[]
    assemblies?: OvenTrayAssembly[]
}

export interface IOvenMessage {
    messageType: OvenMessageType
    requestId?: number
}

export interface OvenInitMessage extends IOvenMessage {
    messageType: OvenMessageType.Init
}

export interface OvenConfigureMessage extends IOvenMessage {
    messageType: OvenMessageType.Configure
    gravity?: Vec3Tuple
    timestep?: number
    substeps?: number
    progressInterval?: number
}

export interface OvenLoadTrayMessage extends IOvenMessage {
    messageType: OvenMessageType.LoadTray
    tray: OvenTray
}

export interface OvenSimulateMessage extends IOvenMessage {
    messageType: OvenMessageType.Simulate
    steps: number
}

export interface OvenSaveStateMessage extends IOvenMessage {
    messageType: OvenMessageType.SaveState
    slotName?: string
}

export interface OvenResetStateMessage extends IOvenMessage {
    messageType: OvenMessageType.ResetState
    slotName?: string
}

export interface OvenGetBodyStatesMessage extends IOvenMessage {
    messageType: OvenMessageType.GetBodyStates
}

export interface OvenSetupRecorderMessage extends IOvenMessage {
    messageType: OvenMessageType.SetupRecorder
    framerate: number
    maxFrameBuffer: number
}

export type OvenRequest =
    | OvenInitMessage
    | OvenConfigureMessage
    | OvenLoadTrayMessage
    | OvenSimulateMessage
    | OvenSaveStateMessage
    | OvenResetStateMessage
    | OvenGetBodyStatesMessage
    | OvenSetupRecorderMessage

export interface OvenBodyKeyframe {
    position: Vec3Tuple
    rotation: QuatTuple
}

export interface OvenRecordingBody {
    bodyId: string
    keyframes: OvenBodyKeyframe[]
}

export interface OvenBodyState {
    bodyId: string
    position: Vec3Tuple
    rotation: QuatTuple
    linearVelocity: Vec3Tuple
    angularVelocity: Vec3Tuple
}

export interface OvenLoadedResponse extends IOvenMessage {
    messageType: OvenMessageType.Loaded
}

export interface OvenReadyResponse extends IOvenMessage {
    messageType: OvenMessageType.Ready
}

export interface OvenResultResponse extends IOvenMessage {
    messageType: OvenMessageType.Result
    success: boolean
    error?: string
}

export interface OvenBodyStatesResponse extends IOvenMessage {
    messageType: OvenMessageType.BodyStates
    bodies: OvenBodyState[]
}

export interface OvenRecordingDataResponse extends IOvenMessage {
    messageType: OvenMessageType.RecordingData
    bodies: OvenRecordingBody[]
    firstStep: number
    lastStep: number
}

export interface OvenSimulationProgressResponse extends IOvenMessage {
    messageType: OvenMessageType.SimulationProgress
    completedSteps: number
    totalSteps: number
}

export interface OvenErrorResponse extends IOvenMessage {
    messageType: OvenMessageType.Error
    error: string
}

export type OvenResponse =
    | OvenLoadedResponse
    | OvenReadyResponse
    | OvenResultResponse
    | OvenBodyStatesResponse
    | OvenRecordingDataResponse
    | OvenSimulationProgressResponse
    | OvenErrorResponse
