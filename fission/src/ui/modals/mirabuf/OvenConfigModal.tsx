import { Box, FormControlLabel, Switch, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import type { ModalImplProps } from "@/ui/components/Modal"
import { useUIContext } from "@/ui/helpers/UIProviderHelpers"

export interface OvenConfigModalProps {
    targetType: "assembly" | "motor" | "rigidnode"
    assemblyIndex: number
    assemblyName: string
    jointGuid?: string
    nodeId?: string
    nodeFixed?: boolean
}

const OvenConfigModal: React.FC<ModalImplProps<void, OvenConfigModalProps>> = ({ modal }) => {
    const { configureScreen } = useUIContext()

    const props = modal!.props.custom as OvenConfigModalProps

    const title =
        props.targetType === "assembly"
            ? `Configure: ${props.assemblyName}`
            : props.targetType === "motor"
                ? `Configure Motor: ${props.jointGuid}`
                : `Configure Node: ${props.nodeId?.slice(0, 16)}…`

    const [fixed, setFixed] = useState(props.nodeFixed ?? false)

    useEffect(() => {
        const handleAccept = async () => {
            if (props.targetType === "rigidnode" && props.nodeId) {
                window.dispatchEvent(new CustomEvent("ovenAction", {
                    detail: {
                        action: "setNodeFixed",
                        assemblyIndex: props.assemblyIndex,
                        nodeId: props.nodeId,
                        fixed,
                    },
                }))
            }
        }

        configureScreen(
            modal!,
            {
                title,
                hideAccept: props.targetType !== "rigidnode",
                acceptText: "Apply",
                hideCancel: false,
            },
            { onBeforeAccept: handleAccept, onCancel: () => {} }
        )
    }, [modal, configureScreen, title, fixed, props])

    if (props.targetType === "rigidnode") {
        return (
            <Box sx={{ width: 480, minHeight: 120, p: 3 }}>
                <Typography variant="body2" sx={{ mb: 2 }}>
                    Node ID: <code>{props.nodeId}</code>
                </Typography>
                <FormControlLabel
                    control={
                        <Switch
                            checked={fixed}
                            onChange={(_, checked) => setFixed(checked)}
                        />
                    }
                    label="Fixed (static body)"
                />
                <Typography variant="caption" sx={{ display: "block", mt: 1, color: "text.secondary" }}>
                    When enabled, this rigid node will be treated as a static body during simulation.
                </Typography>
            </Box>
        )
    }

    return (
        <Box sx={{ width: 480, minHeight: 200, p: 3 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Configuration options will go here.
            </Typography>
        </Box>
    )
}

export default OvenConfigModal
