import { Data } from "@/aps/APSDataManagement"
import Label from "../Label"
import { Stack } from "@mui/material"
import { DeleteButton, PositiveIconButton, SynthesisIcons } from "../StyledComponents"
import MirabufCachingService, { APSCacheStatus } from "@/mirabuf/MirabufLoader"
import { useCallback, useState } from "react"

interface HubItemProps {
    file: Data
    onDownload: (data: Data) => void
    onSpawn: (data: Data) => void
    onDelete: (data: Data) => void
}

const HubItem: React.FC<HubItemProps> = ({ file, onDownload, onSpawn, onDelete }) => {
    const name = `${file.attributes.displayName!.replace(".mira", "")}${file.attributes.versionNumber !== undefined ? ` (v${file.attributes.versionNumber})` : ""}`

    const [cacheStatus, setCacheStatus] = useState<APSCacheStatus>(MirabufCachingService.aspCacheStatus(file));

    const deleteItem = useCallback(() => {
        onDelete(file)
        setCacheStatus(MirabufCachingService.aspCacheStatus(file))
    }, [])

    const updateItem = useCallback(() => {
        onDelete(file)
        onDownload(file)
    }, []);

    return (
        <Stack justifyContent={"space-between"} alignItems={"center"} gap={"1rem"} direction="row">
            <Label size="md" className="text-wrap break-all">
                {name.replace(/.mira$/, "")}
            </Label>
            <Stack
                key={`button-box-${file.id}`}
                direction="row-reverse"
                gap={"0.25rem"}
                justifyContent={"center"}
                alignItems={"center"}
            >
                {cacheStatus == APSCacheStatus.Missing ? (<>
                    <PositiveIconButton onClick={() => onDownload(file)}>
                        {SynthesisIcons.DOWNLOAD_LARGE}
                    </PositiveIconButton>
                </>) : (<>
                    {cacheStatus == APSCacheStatus.Stored ? (
                        <PositiveIconButton onClick={() => onSpawn(file)}>
                            {SynthesisIcons.ADD_LARGE}
                        </PositiveIconButton>
                    ) : (
                        <PositiveIconButton onClick={updateItem}>
                            {SynthesisIcons.IMPORT}
                        </PositiveIconButton>
                    )}
                    {DeleteButton(deleteItem)}
                </>)}
            </Stack>
        </Stack>
    )
}

export default HubItem
