// TODO: Revisit this modal — the cached/default asset sections are a rough port from
// ImportMirabufPanel and should be cleaned up. Consider extracting shared item card
// components, adding delete-from-cache support, and a "Download All" button for defaults.

import { Stack } from "@mui/material"
import { useEffect, useCallback, useMemo, useState } from "react"
import MirabufCachingService, { MiraType, MirabufCacheInfo } from "@/mirabuf/MirabufLoader"
import DefaultAssetLoader, { type DefaultAssetInfo } from "@/mirabuf/DefaultAssetLoader"
import type { ModalImplProps } from "@/ui/components/Modal"
import { CloseType, useUIContext } from "@/ui/helpers/UIProviderHelpers"
import HubMirabufItems from "@/ui/components/hub/HubMirabufItems"
import { ProgressHandle } from "@/ui/components/ProgressNotificationData"
import { Data } from "@/aps/APSDataManagement"
import { mirabuf } from "@/proto/mirabuf"
import Label from "@/ui/components/Label"
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    SynthesisIcons,
    PositiveIconButton,
} from "@/ui/components/StyledComponents"
import { MdExpandMore } from "react-icons/md"

interface ImportPrototypeModalProps {
}

const loadAssemblyIntoOven = async (cacheInfo: MirabufCacheInfo, progressHandle: ProgressHandle) => {
    const assembly = await MirabufCachingService.get(cacheInfo.hash)
    if (!assembly) {
        progressHandle.fail("Failed to retrieve assembly from the caching service.")
        return;
    }

    const assemblyData = mirabuf.Assembly.encode(assembly).finish()

    window.dispatchEvent(new CustomEvent("ovenAction", {
        detail: {
            action: "addAssembly",
            assembly,
            assemblyData,
        },
    }))

    progressHandle.done()
}

interface ItemCardProps {
    id: string
    name: string
    icon: React.ReactNode
    onClick: () => void
}

const ItemCard: React.FC<ItemCardProps> = ({ id, name, icon, onClick }) => (
    <Stack key={id} justifyContent="space-between" alignItems="center" gap="1rem" direction="row">
        <Label size="md" className="text-wrap break-all">
            {name.replace(/.mira$/, "")}
        </Label>
        {PositiveIconButton({ children: icon, onClick })}
    </Stack>
)

const ImportPrototypeModal: React.FC<ModalImplProps<void, ImportPrototypeModalProps>> = ({ modal }) => {
    const { closeModal, configureScreen } = useUIContext()

    const [cachedRobots, setCachedRobots] = useState(MirabufCachingService.getAll(MiraType.ROBOT))
    const manifestRobots = useMemo(() => DefaultAssetLoader.robots, [])

    useEffect(() => {
        const onCancel = () => { }
        const onBeforeAccept = async () => { }

        configureScreen(
            modal!,
            { title: "Load Assembly", hideAccept: true, hideCancel: false },
            { onBeforeAccept, onCancel }
        )
    }, [modal, configureScreen])

    const selectCache = useCallback(
        (info: MirabufCacheInfo) => {
            const status = new ProgressHandle(info.name ?? "Assembly")
            status.update("Loading from cache...", 0.05)
            loadAssemblyIntoOven(info, status)
            closeModal(CloseType.Accept)
        },
        [closeModal]
    )

    const selectRemote = useCallback(
        (info: DefaultAssetInfo) => {
            const status = new ProgressHandle(info.name)
            status.update("Downloading from Synthesis...", 0.05)

            MirabufCachingService.cacheRemote(info.remotePath, info.miraType, info.name, info.hash)
                .then(async cacheInfo => {
                    if (cacheInfo) {
                        setCachedRobots(MirabufCachingService.getAll(MiraType.ROBOT))
                        await loadAssemblyIntoOven(cacheInfo, status)
                    } else {
                        status.fail("Failed to cache")
                    }
                })
                .catch(() => status.fail())

            closeModal(CloseType.Accept)
        },
        [closeModal]
    )

    const downloadAps = useCallback(
        (data: Data) => {
            const status = new ProgressHandle(data.attributes.displayName ?? data.id)
            status.update("Downloading from APS...", 0.05)

            MirabufCachingService.cacheAPS(data, MiraType.ROBOT)
                .then(async cacheInfo => {
                    if (cacheInfo) {
                        await loadAssemblyIntoOven(cacheInfo, status)
                    } else {
                        status.fail("Failed to cache")
                    }
                })
                .catch(() => status.fail())

            closeModal(CloseType.Accept)
        },
        [closeModal]
    )

    const spawnAps = useCallback(
        (data: Data) => {
            const status = new ProgressHandle(data.attributes.displayName ?? data.id)
            status.update("Fetching from cache...", 0.05)

            const cacheInfo = MirabufCachingService.getAps(data)
            if (cacheInfo) {
                loadAssemblyIntoOven(cacheInfo, status)
            } else {
                status.fail("Failed to cache")
            }
            closeModal(CloseType.Accept)
        },
        [closeModal]
    )

    const cachedElements = useMemo(
        () =>
            cachedRobots
                .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
                .map(info => (
                    <ItemCard
                        key={info.hash}
                        id={info.hash}
                        name={info.name || "Unnamed"}
                        icon={SynthesisIcons.ADD_LARGE}
                        onClick={() => selectCache(info)}
                    />
                )),
        [cachedRobots, selectCache]
    )

    const defaultElements = useMemo(() => {
        const uncached = manifestRobots.filter(
            remote => !cachedRobots.some(c => c.hash === remote.hash)
        )
        return uncached
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(item => (
                <ItemCard
                    key={item.hash}
                    id={item.hash}
                    name={item.name}
                    icon={SynthesisIcons.DOWNLOAD_LARGE}
                    onClick={() => selectRemote(item)}
                />
            ))
    }, [manifestRobots, cachedRobots, selectRemote])

    return (
        <Stack
            direction="column"
            gap={2}
            sx={{ width: "60vw", height: "60vh", overflowY: "auto" }}
        >
            <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<MdExpandMore size={24} />}>
                    <Label size="md" className="text-center mt-[4pt] mb-[2pt] mx-[5%]">
                        {`${cachedElements.length} Saved Robot${cachedElements.length === 1 ? "" : "s"}`}
                    </Label>
                </AccordionSummary>
                <AccordionDetails>
                    {cachedElements.length > 0 ? cachedElements : (
                        <Label size="sm">No Saved Assets</Label>
                    )}
                </AccordionDetails>
            </Accordion>

            <Accordion>
                <AccordionSummary expandIcon={<MdExpandMore size={24} />}>
                    <Label size="md" className="text-center mt-[4pt] mb-[2pt] mx-[5%]">
                        {`${defaultElements.length} Default Robot${defaultElements.length === 1 ? "" : "s"}`}
                    </Label>
                </AccordionSummary>
                <AccordionDetails>
                    {defaultElements.length > 0 ? defaultElements : (
                        <Label size="sm">No Assets Found</Label>
                    )}
                </AccordionDetails>
            </Accordion>

            <HubMirabufItems onDownload={downloadAps} onSpawn={spawnAps} />
        </Stack>
    )
}

export default ImportPrototypeModal
