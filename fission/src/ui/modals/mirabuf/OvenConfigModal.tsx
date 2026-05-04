import { Box, FormControlLabel, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material"
import { useEffect, useState } from "react"
import type { ModalImplProps } from "@/ui/components/Modal"
import { useUIContext } from "@/ui/helpers/UIProviderHelpers"
import type { OvenMotorMode } from "@/systems/physics/oven/OvenProtocol"
import type { JointMotionType } from "@/ui/components/OvenTrayPanel"

export interface OvenConfigModalProps {
    targetType: "assembly" | "motor" | "rigidnode" | "joint"
    assemblyIndex: number
    assemblyName: string
    jointGuid?: string
    nodeId?: string
    nodeFixed?: boolean
    jointName?: string
    jointMotionType?: JointMotionType
    motorMode?: OvenMotorMode
    motorTargetValue?: number
    motorMaxForce?: number
    initialLinearVelocity?: [number, number, number]
    initialAngularVelocity?: [number, number, number]
}

const OvenConfigModal: React.FC<ModalImplProps<void, OvenConfigModalProps>> = ({ modal }) => {
    const { configureScreen } = useUIContext()

    const props = modal!.props.custom as OvenConfigModalProps

    const title =
        props.targetType === "assembly"
            ? `Configure: ${props.assemblyName}`
            : props.targetType === "joint"
                ? `Configure Joint: ${props.jointName ?? props.jointGuid}`
                : props.targetType === "motor"
                    ? `Configure Motor: ${props.jointGuid}`
                    : `Configure Node: ${props.nodeId?.slice(0, 16)}…`

    const [fixed, setFixed] = useState(props.nodeFixed ?? false)

    const isRotational = props.jointMotionType === "revolute"
    const [motorMode, setMotorMode] = useState<OvenMotorMode>(props.motorMode ?? "velocity")
    const [targetValue, setTargetValue] = useState(props.motorTargetValue ?? 0)
    const [maxForce, setMaxForce] = useState(props.motorMaxForce ?? (isRotational ? 10 : 100))

    const [linVel, setLinVel] = useState<[number, number, number]>(props.initialLinearVelocity ?? [0, 0, 0])
    const [angVel, setAngVel] = useState<[number, number, number]>(props.initialAngularVelocity ?? [0, 0, 0])

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
            } else if (props.targetType === "joint" && props.jointGuid) {
                window.dispatchEvent(new CustomEvent("ovenAction", {
                    detail: {
                        action: "setMotor",
                        assemblyIndex: props.assemblyIndex,
                        jointGuid: props.jointGuid,
                        mode: motorMode,
                        targetValue,
                        maxForce,
                    },
                }))
            } else if (props.targetType === "assembly") {
                window.dispatchEvent(new CustomEvent("ovenAction", {
                    detail: {
                        action: "configureAssembly",
                        assemblyIndex: props.assemblyIndex,
                        initialLinearVelocity: linVel,
                        initialAngularVelocity: angVel,
                    },
                }))
            }
        }

        const canAccept = props.targetType === "rigidnode" || props.targetType === "joint" || props.targetType === "assembly"

        configureScreen(
            modal!,
            {
                title,
                hideAccept: !canAccept,
                acceptText: "Apply",
                hideCancel: false,
            },
            { onBeforeAccept: handleAccept, onCancel: () => {} }
        )
    }, [modal, configureScreen, title, fixed, motorMode, targetValue, maxForce, linVel, angVel, props])

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

    if (props.targetType === "joint") {
        const velocityUnit = isRotational ? "rad/s" : "m/s"
        const positionUnit = isRotational ? "rad" : "m"
        const forceLabel = isRotational ? "Max Torque (N·m)" : "Max Force (N)"

        return (
            <Box sx={{ width: 480, minHeight: 200, p: 3 }}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {props.jointName}
                </Typography>
                <Typography variant="caption" sx={{ display: "block", mb: 2, color: "text.secondary" }}>
                    {isRotational ? "Revolute" : "Linear"} joint — {props.jointGuid}
                </Typography>

                <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                    Motor Target
                </Typography>
                <ToggleButtonGroup
                    value={motorMode}
                    exclusive
                    onChange={(_, val) => { if (val) setMotorMode(val as OvenMotorMode) }}
                    size="small"
                    sx={{ mb: 2 }}
                >
                    <ToggleButton value="velocity">Velocity</ToggleButton>
                    <ToggleButton value="position">Position</ToggleButton>
                </ToggleButtonGroup>

                <TextField
                    fullWidth
                    type="number"
                    label={motorMode === "velocity" ? `Target Velocity (${velocityUnit})` : `Target Position (${positionUnit})`}
                    value={targetValue}
                    onChange={e => setTargetValue(parseFloat(e.target.value) || 0)}
                    size="small"
                    sx={{ mb: 2 }}
                />

                <TextField
                    fullWidth
                    type="number"
                    label={forceLabel}
                    value={maxForce}
                    onChange={e => setMaxForce(parseFloat(e.target.value) || 0)}
                    size="small"
                />

                <Typography variant="caption" sx={{ display: "block", mt: 1.5, color: "text.secondary" }}>
                    The motor will be applied during simulation. Set the target {motorMode === "velocity" ? "velocity" : "position"} and
                    maximum {isRotational ? "torque" : "force"} the motor can exert.
                </Typography>
            </Box>
        )
    }

    if (props.targetType === "assembly") {
        const updateLinVel = (axis: number, value: number) =>
            setLinVel(prev => { const next = [...prev] as [number, number, number]; next[axis] = value; return next })
        const updateAngVel = (axis: number, value: number) =>
            setAngVel(prev => { const next = [...prev] as [number, number, number]; next[axis] = value; return next })

        return (
            <Box sx={{ width: 480, minHeight: 200, p: 3 }}>
                <Typography variant="body2" sx={{ mb: 2, fontWeight: 500 }}>
                    Initial Linear Velocity (m/s)
                </Typography>
                <Stack direction="row" gap={1.5} sx={{ mb: 3 }}>
                    {(["X", "Y", "Z"] as const).map((label, i) => (
                        <TextField
                            key={label}
                            type="number"
                            label={label}
                            value={linVel[i]}
                            onChange={e => updateLinVel(i, parseFloat(e.target.value) || 0)}
                            size="small"
                            sx={{ flex: 1 }}
                        />
                    ))}
                </Stack>

                <Typography variant="body2" sx={{ mb: 2, fontWeight: 500 }}>
                    Initial Angular Velocity (rad/s)
                </Typography>
                <Stack direction="row" gap={1.5}>
                    {(["X", "Y", "Z"] as const).map((label, i) => (
                        <TextField
                            key={label}
                            type="number"
                            label={label}
                            value={angVel[i]}
                            onChange={e => updateAngVel(i, parseFloat(e.target.value) || 0)}
                            size="small"
                            sx={{ flex: 1 }}
                        />
                    ))}
                </Stack>

                <Typography variant="caption" sx={{ display: "block", mt: 2, color: "text.secondary" }}>
                    These velocities will be applied to all dynamic bodies in this assembly at the start of the simulation.
                </Typography>
            </Box>
        )
    }

    return (
        <Box sx={{ width: 480, minHeight: 200, p: 3 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
                No configuration available for this item.
            </Typography>
        </Box>
    )
}

export default OvenConfigModal
