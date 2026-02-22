import { Data } from "@/aps/APSDataManagement"
import Label from "../Label"
import { Stack } from "@mui/material"
import { ReactNode } from "react"
import { DeleteButton, PositiveIconButton } from "../StyledComponents"

interface HubItemProps {
    file: Data
    primaryButtonNode: ReactNode
    primaryOnClick: (data: Data) => void
    secondaryOnClick?: (data: Data) => void
}

const HubItem: React.FC<HubItemProps> = ({ file, primaryButtonNode, primaryOnClick, secondaryOnClick }) => {
    const name = `${file.attributes.displayName!.replace(".mira", "")}${file.attributes.versionNumber !== undefined ? ` (v${file.attributes.versionNumber})` : ""}`

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
                {PositiveIconButton({
                    children: primaryButtonNode,
                    onClick: () => primaryOnClick(file),
                })}
                {secondaryOnClick && DeleteButton(() => secondaryOnClick(file))}
            </Stack>
        </Stack>
    )
}

export default HubItem
