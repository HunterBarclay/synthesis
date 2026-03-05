export enum OvenMessageType {
    Init = "init",

}

export interface IOvenMessage {
    messageType: OvenMessageType
}

export interface OvenInitMessage extends IOvenMessage {
    messageType: OvenMessageType.Init
}
