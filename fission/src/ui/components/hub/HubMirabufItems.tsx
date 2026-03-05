import { Data, MirabufFilesStatusUpdateEvent, MirabufFilesUpdateEvent, getMirabufFiles, hasMirabufFiles, requestMirabufFiles } from "@/aps/APSDataManagement";
import TaskStatus from "@/util/TaskStatus";
import { CircularProgress, Stack, Tooltip } from "@mui/material";
import { useEffect, useState } from "react";
import { MdExpandMore } from "react-icons/md";
import Label from "../Label";
import { Accordion, AccordionDetails, AccordionSummary, RefreshButton, SynthesisIcons } from "../StyledComponents";
import HubItem from "./HubItem";
import MirabufCachingService from "@/mirabuf/MirabufLoader";

interface HubMirabufItemsProps {
    onDownload: (data: Data) => void
    onSpawn: (data: Data) => void
}

const deleteInfo = (data: Data) => {
    const info = MirabufCachingService.getAps(data);
    if (info)
        MirabufCachingService.remove(info.hash);
}

const HubMirabufItems: React.FC<HubMirabufItemsProps> = ({ onDownload, onSpawn }) => {

    const [filesStatus, setFilesStatus] = useState<TaskStatus>({
        isDone: false,
        message: "Waiting on APS...",
        progress: 0,
    })
    const [files, setFiles] = useState<Data[] | undefined>(undefined)

    useEffect(() => {
        const updateFilesStatus = (e: Event) => {
            setFilesStatus((e as MirabufFilesStatusUpdateEvent).status)
        }

        const updateFiles = (e: Event) => {
            setFiles((e as MirabufFilesUpdateEvent).data)
        }

        window.addEventListener(MirabufFilesStatusUpdateEvent.EVENT_KEY, updateFilesStatus)
        window.addEventListener(MirabufFilesUpdateEvent.EVENT_KEY, updateFiles)

        return () => {
            window.removeEventListener(MirabufFilesStatusUpdateEvent.EVENT_KEY, updateFilesStatus)
            window.removeEventListener(MirabufFilesUpdateEvent.EVENT_KEY, updateFiles)
        }
    })

    useEffect(() => {
        if (!hasMirabufFiles()) {
            requestMirabufFiles().catch(console.error)
        } else {
            setFiles(getMirabufFiles())
        }
    }, [])

    return (<>
        <Accordion>
            <AccordionSummary expandIcon={<MdExpandMore size={24} />}>
                <Stack
                    direction="row"
                    key={`remote-label-container`}
                    gap={"0.25rem"}
                    justifyContent={"center"}
                    alignItems={"center"}
                >
                    <Label size="md" className="text-center mt-[4pt] mb-[2pt] mx-[5%]">
                        {files ? (
                            `${files.length} Remote Asset${files.length === 1 ? "" : "s"}`
                        ) : (
                            <Tooltip title={filesStatus.message}>
                                <Stack direction="row" gap={1} alignItems="center">
                                    <Label size="md">Loading from APS...</Label>
                                    <CircularProgress
                                        size="1em"
                                        variant="determinate"
                                        value={filesStatus.isDone ? 100 : filesStatus.progress * 100}
                                    />
                                </Stack>
                            </Tooltip>
                        )}
                    </Label>
                    {files && RefreshButton(() => requestMirabufFiles())}
                </Stack>
            </AccordionSummary>
            <AccordionDetails>
                {files && files.length > 0 ? (
                    files.sort((a, b) => a.attributes.displayName!.localeCompare(b.attributes.displayName!)).map(x => (
                        <HubItem
                            key={x.id}
                            file={x}
                            onDownload={onDownload}
                            onSpawn={onSpawn}
                            onDelete={(data) => deleteInfo(data)}
                        />
                    ))
                ) : filesStatus.isDone ? (
                    <Label size="sm">No Assets Found</Label>
                ) : (
                    <Label size="sm">Loading from APS...</Label>
                )}
            </AccordionDetails>
        </Accordion>
    </>)
}

export default HubMirabufItems;
