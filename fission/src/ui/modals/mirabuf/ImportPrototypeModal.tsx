import { Box, Stack, styled } from "@mui/material"
import { type ChangeEvent, useEffect, useState, useCallback } from "react"
import MirabufCachingService, { MiraType, MirabufCacheInfo } from "@/mirabuf/MirabufLoader"
import Label from "@/ui/components/Label"
import type { ModalImplProps } from "@/ui/components/Modal"
import { Button, ToggleButton, ToggleButtonGroup } from "@/ui/components/StyledComponents"
import { CloseType, useUIContext } from "@/ui/helpers/UIProviderHelpers"
import HubMirabufItems from "@/ui/components/hub/HubMirabufItems"
import { createPrototype } from "@/mirabuf/prototype/PrototypeSceneObject"
import World from "@/systems/World"
import { ProgressHandle } from "@/ui/components/ProgressNotificationData"
import { Data } from "@/aps/APSDataManagement"

interface ImportPrototypeModalProps {
}

const spawnCachedMira = async (cacheInfo: MirabufCacheInfo, progressHandle: ProgressHandle) => {
    const assembly = await MirabufCachingService.get(cacheInfo.hash)
    if (!assembly) {
        progressHandle.fail("Failed to retrieve assembly from the caching service.")
        return;
    }

    const prototype = await createPrototype(assembly)
    if (!prototype) {
        progressHandle.fail("Failed to create prototype from Mirabuf assembly.")
        return;
    }

    World.sceneRenderer.registerSceneObject(prototype)
    progressHandle.done()
}

const ImportPrototypeModal: React.FC<ModalImplProps<void, ImportPrototypeModalProps>> = ({ modal }) => {
    // update tooltip based on type of drivetrain, receive message from Synthesis
    const { closeModal, configureScreen } = useUIContext()

    // const { configurationType } = modal!.props.custom

    useEffect(() => {
        const onCancel = () => { }

        const onBeforeAccept = async () => { }

        configureScreen(
            modal!,
            { title: "Load Prototype", hideAccept: true, hideCancel: false },
            { onBeforeAccept, onCancel }
        )
    }, [modal, configureScreen])

    const selectAPS = useCallback(
        (data: Data) => {
            const status = new ProgressHandle(data.attributes.displayName ?? data.id)
            status.update("Downloading from APS...", 0.05)

            MirabufCachingService.cacheAPS(data, MiraType.ROBOT)
                .then(async cacheInfo => {
                    if (cacheInfo) {
                        await spawnCachedMira(cacheInfo, status)
                    } else {
                        status.fail("Failed to cache")
                    }
                })
                .catch(() => status.fail())
                
            closeModal(CloseType.Accept)
        },
        [closeModal]
    )

    return (
        <Box sx={{
            width: '60vw',
            height: '60vh',
            overflowY: 'auto'
        }}>
            <HubMirabufItems onDownload={selectAPS} />
        </Box>
    )
}

export default ImportPrototypeModal
