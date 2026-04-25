export enum OvenMessageType {
    Init = "init",
    Configure = "configure",
    AddBody = "addBody",
    MoveBody = "moveBody",
    RemoveBody = "removeBody",
    AddJoint = "addJoint",
    RemoveJoint = "removeJoint",
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
}

export type Vec3Tuple = [number, number, number]
export type QuatTuple = [number, number, number, number]

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
}

export interface OvenAddBodyMessage extends IOvenMessage {
    messageType: OvenMessageType.AddBody
    bodyId: string
    halfExtents: Vec3Tuple
    position: Vec3Tuple
    rotation: QuatTuple
    mass?: number
    fixed?: boolean
    friction?: number
    restitution?: number
}

export interface OvenMoveBodyMessage extends IOvenMessage {
    messageType: OvenMessageType.MoveBody
    bodyId: string
    position?: Vec3Tuple
    rotation?: QuatTuple
    linearVelocity?: Vec3Tuple
    angularVelocity?: Vec3Tuple
}

export interface OvenRemoveBodyMessage extends IOvenMessage {
    messageType: OvenMessageType.RemoveBody
    bodyId: string
}

export type OvenJointType = "fixed" | "hinge" | "slider"

export interface OvenAddJointMessage extends IOvenMessage {
    messageType: OvenMessageType.AddJoint
    jointId: string
    bodyIdA: string
    bodyIdB: string
    jointType: OvenJointType
    anchor: Vec3Tuple
    axis?: Vec3Tuple
    limitsMin?: number
    limitsMax?: number
}

export interface OvenRemoveJointMessage extends IOvenMessage {
    messageType: OvenMessageType.RemoveJoint
    jointId: string
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
    | OvenAddBodyMessage
    | OvenMoveBodyMessage
    | OvenRemoveBodyMessage
    | OvenAddJointMessage
    | OvenRemoveJointMessage
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
    | OvenErrorResponse
