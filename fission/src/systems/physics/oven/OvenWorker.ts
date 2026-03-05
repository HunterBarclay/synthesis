import { OvenInitMessage, OvenMessageType } from "./OvenProtocol";
import OvenSystem from "./OvenSystem";

let ovenSystem: OvenSystem | undefined;

const handleInitMessage = (message: OvenInitMessage) => {

}

self.addEventListener("message", e => {
    if (!e.data.messageType)
        return;

    switch (e.data.messageType as OvenMessageType) {
        case OvenMessageType.Init:
            
        default:
            return;
    }
})