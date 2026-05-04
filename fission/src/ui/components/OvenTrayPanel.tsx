import {
    Stack,
    Typography,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    IconButton,
    List,
    ListItem,
    ListItemText,
    Chip,
    Divider,
    FormControlLabel,
    Switch,
} from "@mui/material"
import { useEffect, useState, useCallback } from "react"
import { FaGear } from "react-icons/fa6"
import { IoTrashBin } from "react-icons/io5"
import { MdExpandMore, MdOpenWith, Md3DRotation, MdClose } from "react-icons/md"
import { useUIContext } from "@/ui/helpers/UIProviderHelpers"
import OvenConfigModal from "@/ui/modals/mirabuf/OvenConfigModal"
import type { OvenMotorMode } from "@/systems/physics/oven/OvenProtocol"

export interface OvenTrayPanelAssembly {
    index: number
    name: string
    motors: OvenTrayPanelMotor[]
    rigidNodes: OvenTrayPanelRigidNode[]
    joints: OvenTrayPanelJoint[]
    initialLinearVelocity?: [number, number, number]
    initialAngularVelocity?: [number, number, number]
}

export interface OvenTrayPanelMotor {
    jointGuid: string
    mode: OvenMotorMode
    targetValue: number
    maxForce?: number
    maxTorque?: number
}

export type JointMotionType = "revolute" | "slider" | "rigid" | "unknown"

export interface OvenTrayPanelJoint {
    jointGuid: string
    name: string
    motionType: JointMotionType
    hasMotor: boolean
}

export interface OvenTrayPanelRigidNode {
    nodeId: string
    isDynamic: boolean
    fixed: boolean
    isRoot: boolean
}

interface GizmoState {
    active: boolean
    assemblyIndex: number
    mode: "translate" | "rotate"
}

interface EnvironmentSettings {
    groundEnabled: boolean
}

const OvenTrayPanel: React.FC = () => {
    const { openModal } = useUIContext()
    const [assemblies, setAssemblies] = useState<OvenTrayPanelAssembly[]>([])
    const [editingLocked, setEditingLocked] = useState(false)
    const [gizmo, setGizmo] = useState<GizmoState>({ active: false, assemblyIndex: -1, mode: "translate" })
    const [envSettings, setEnvSettings] = useState<EnvironmentSettings>({ groundEnabled: false })

    useEffect(() => {
        const onResult = (e: Event) => {
            const detail = (e as CustomEvent).detail
            if (detail?.action === "trayUpdated") {
                setAssemblies(detail.assemblies as OvenTrayPanelAssembly[])
                if (detail.environment) {
                    setEnvSettings(detail.environment as EnvironmentSettings)
                }
            } else if (detail?.action === "editingState") {
                setEditingLocked(detail.locked as boolean)
                if (detail.locked) {
                    setGizmo({ active: false, assemblyIndex: -1, mode: "translate" })
                }
            } else if (detail?.action === "gizmoState") {
                setGizmo({
                    active: detail.active as boolean,
                    assemblyIndex: detail.assemblyIndex as number,
                    mode: (detail.mode as "translate" | "rotate") ?? "translate",
                })
            }
        }
        window.addEventListener("ovenResult", onResult)
        return () => window.removeEventListener("ovenResult", onResult)
    }, [])

    const handleRemoveAssembly = useCallback((index: number) => {
        if (editingLocked) return
        window.dispatchEvent(new CustomEvent("ovenAction", {
            detail: { action: "removeAssembly", assemblyIndex: index },
        }))
    }, [editingLocked])

    const handleConfigureAssembly = useCallback((asm: OvenTrayPanelAssembly) => {
        if (editingLocked) return
        openModal(OvenConfigModal, {
            targetType: "assembly",
            assemblyIndex: asm.index,
            assemblyName: asm.name,
            initialLinearVelocity: asm.initialLinearVelocity,
            initialAngularVelocity: asm.initialAngularVelocity,
        })
    }, [editingLocked, openModal])

    const handleConfigureRigidNode = useCallback((asm: OvenTrayPanelAssembly, node: OvenTrayPanelRigidNode) => {
        if (editingLocked) return
        openModal(OvenConfigModal, {
            targetType: "rigidnode",
            assemblyIndex: asm.index,
            assemblyName: asm.name,
            nodeId: node.nodeId,
            nodeFixed: node.fixed,
        })
    }, [editingLocked, openModal])

    const handleConfigureJoint = useCallback((asm: OvenTrayPanelAssembly, joint: OvenTrayPanelJoint) => {
        if (editingLocked) return
        const existingMotor = asm.motors.find(m => m.jointGuid === joint.jointGuid)
        const existingForce = existingMotor
            ? (joint.motionType === "revolute" ? existingMotor.maxTorque : existingMotor.maxForce)
            : undefined
        openModal(OvenConfigModal, {
            targetType: "joint",
            assemblyIndex: asm.index,
            assemblyName: asm.name,
            jointGuid: joint.jointGuid,
            jointName: joint.name,
            jointMotionType: joint.motionType,
            motorMode: existingMotor?.mode ?? "velocity",
            motorTargetValue: existingMotor?.targetValue ?? 0,
            motorMaxForce: existingForce,
        })
    }, [editingLocked, openModal])

    const handleEnableGizmo = useCallback((assemblyIndex: number, mode: "translate" | "rotate") => {
        if (editingLocked) return
        window.dispatchEvent(new CustomEvent("ovenAction", {
            detail: { action: "enableGizmo", assemblyIndex, mode },
        }))
    }, [editingLocked])

    const handleSetGizmoMode = useCallback((mode: "translate" | "rotate") => {
        window.dispatchEvent(new CustomEvent("ovenAction", {
            detail: { action: "setGizmoMode", mode },
        }))
        setGizmo(prev => ({ ...prev, mode }))
    }, [])

    const handleDisableGizmo = useCallback(() => {
        window.dispatchEvent(new CustomEvent("ovenAction", {
            detail: { action: "disableGizmo" },
        }))
    }, [])

    const handleToggleGround = useCallback((enabled: boolean) => {
        if (editingLocked) return
        window.dispatchEvent(new CustomEvent("ovenAction", {
            detail: { action: "setGroundEnabled", enabled },
        }))
    }, [editingLocked])

    const isGizmoActiveFor = (asmIndex: number) => gizmo.active && gizmo.assemblyIndex === asmIndex

    return (
        <Stack
            className="select-none absolute top-4 right-4 rounded-xl overflow-hidden"
            sx={{
                bgcolor: "background.paper",
                boxShadow: 8,
                width: 320,
                maxHeight: "80vh",
                overflowY: "auto",
            }}
        >
            {/* Environment Settings */}
            <Accordion disableGutters elevation={0} sx={{ "&:before": { display: "none" }, bgcolor: "transparent" }}>
                <AccordionSummary
                    expandIcon={<MdExpandMore />}
                    sx={{ px: 2, minHeight: 40, "& .MuiAccordionSummary-content": { alignItems: "center", gap: 1 } }}
                >
                    <Typography
                        variant="subtitle2"
                        sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: 1, fontSize: "0.7rem" }}
                    >
                        Environment
                    </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 2, pt: 0, pb: 1 }}>
                    <FormControlLabel
                        control={
                            <Switch
                                size="small"
                                checked={envSettings.groundEnabled}
                                disabled={editingLocked}
                                onChange={(_, checked) => handleToggleGround(checked)}
                            />
                        }
                        label={<Typography variant="body2">Ground Plane</Typography>}
                    />
                </AccordionDetails>
            </Accordion>

            {assemblies.length > 0 && (
                <Typography
                    variant="subtitle2"
                    sx={{ px: 2, pt: 0.5, pb: 0.5, color: "text.secondary", textTransform: "uppercase", letterSpacing: 1, fontSize: "0.7rem" }}
                >
                    Assemblies
                </Typography>
            )}

            {assemblies.map(asm => (
                <Accordion
                    key={asm.index}
                    disableGutters
                    elevation={0}
                    sx={{
                        "&:before": { display: "none" },
                        bgcolor: "transparent",
                    }}
                >
                    <AccordionSummary
                        expandIcon={<MdExpandMore />}
                        sx={{ px: 2, minHeight: 40, "& .MuiAccordionSummary-content": { alignItems: "center", gap: 1 } }}
                    >
                        <Typography variant="body2" sx={{ flex: 1, fontWeight: 500 }} noWrap>
                            {asm.name}
                        </Typography>
                        <IconButton
                            size="small"
                            disabled={editingLocked}
                            onClick={e => { e.stopPropagation(); handleConfigureAssembly(asm) }}
                            sx={{ color: "text.secondary" }}
                        >
                            <FaGear size={14} />
                        </IconButton>
                        <IconButton
                            size="small"
                            disabled={editingLocked}
                            onClick={e => { e.stopPropagation(); handleRemoveAssembly(asm.index) }}
                            sx={{ color: "error.main" }}
                        >
                            <IoTrashBin size={14} />
                        </IconButton>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 1, pt: 0, pb: 1 }}>
                        {/* Gizmo Controls */}
                        <Stack direction="row" alignItems="center" gap={0.5} sx={{ px: 1, pb: 1 }}>
                            {!isGizmoActiveFor(asm.index) ? (
                                <IconButton
                                    size="small"
                                    disabled={editingLocked}
                                    onClick={() => handleEnableGizmo(asm.index, "translate")}
                                    sx={{ color: "primary.main" }}
                                    title="Enable transform gizmo"
                                >
                                    <MdOpenWith size={18} />
                                </IconButton>
                            ) : (
                                <>
                                    <IconButton
                                        size="small"
                                        onClick={() => handleSetGizmoMode("translate")}
                                        sx={{
                                            color: gizmo.mode === "translate" ? "primary.main" : "text.secondary",
                                            bgcolor: gizmo.mode === "translate" ? "action.selected" : undefined,
                                        }}
                                        title="Move"
                                    >
                                        <MdOpenWith size={16} />
                                    </IconButton>
                                    <IconButton
                                        size="small"
                                        onClick={() => handleSetGizmoMode("rotate")}
                                        sx={{
                                            color: gizmo.mode === "rotate" ? "primary.main" : "text.secondary",
                                            bgcolor: gizmo.mode === "rotate" ? "action.selected" : undefined,
                                        }}
                                        title="Rotate"
                                    >
                                        <Md3DRotation size={16} />
                                    </IconButton>
                                    <IconButton
                                        size="small"
                                        onClick={handleDisableGizmo}
                                        sx={{ color: "error.main", ml: "auto" }}
                                        title="Disable gizmo"
                                    >
                                        <MdClose size={16} />
                                    </IconButton>
                                </>
                            )}
                        </Stack>

                        <Divider sx={{ mb: 0.5 }} />

                        {/* Rigid Nodes */}
                        <Typography
                            variant="caption"
                            sx={{ pl: 2, color: "text.secondary", fontWeight: 600, textTransform: "uppercase", fontSize: "0.6rem", letterSpacing: 0.5 }}
                        >
                            Rigid Nodes
                        </Typography>
                        {asm.rigidNodes.length === 0 ? (
                            <Typography variant="caption" sx={{ color: "text.disabled", pl: 2, display: "block" }}>
                                No rigid nodes
                            </Typography>
                        ) : (
                            <List dense disablePadding>
                                {asm.rigidNodes.map(node => (
                                    <ListItem
                                        key={node.nodeId}
                                        sx={{ pl: 2, pr: 1, py: 0.25 }}
                                        secondaryAction={
                                            <IconButton
                                                size="small"
                                                edge="end"
                                                disabled={editingLocked}
                                                onClick={() => handleConfigureRigidNode(asm, node)}
                                                sx={{ color: "text.secondary" }}
                                            >
                                                <FaGear size={12} />
                                            </IconButton>
                                        }
                                    >
                                        <ListItemText
                                            primary={
                                                <Stack direction="row" alignItems="center" gap={0.75}>
                                                    <Typography variant="caption" noWrap sx={{ maxWidth: 120 }}>
                                                        {node.nodeId.slice(0, 12)}…
                                                    </Typography>
                                                    {node.isRoot && (
                                                        <Chip
                                                            label="root"
                                                            size="small"
                                                            color="info"
                                                            variant="outlined"
                                                            sx={{ height: 18, fontSize: "0.6rem" }}
                                                        />
                                                    )}
                                                    {node.fixed && (
                                                        <Chip
                                                            label="fixed"
                                                            size="small"
                                                            color="warning"
                                                            variant="outlined"
                                                            sx={{ height: 18, fontSize: "0.6rem" }}
                                                        />
                                                    )}
                                                    {!node.isDynamic && !node.fixed && (
                                                        <Chip
                                                            label="static"
                                                            size="small"
                                                            variant="outlined"
                                                            sx={{ height: 18, fontSize: "0.6rem" }}
                                                        />
                                                    )}
                                                </Stack>
                                            }
                                        />
                                    </ListItem>
                                ))}
                            </List>
                        )}

                        <Divider sx={{ my: 0.5 }} />

                        {/* Joints */}
                        <Typography
                            variant="caption"
                            sx={{ pl: 2, color: "text.secondary", fontWeight: 600, textTransform: "uppercase", fontSize: "0.6rem", letterSpacing: 0.5 }}
                        >
                            Joints
                        </Typography>
                        {asm.joints.length === 0 ? (
                            <Typography variant="caption" sx={{ color: "text.disabled", pl: 2, display: "block" }}>
                                No joints
                            </Typography>
                        ) : (
                            <List dense disablePadding>
                                {asm.joints.map(joint => {
                                    const isConfigurable = joint.motionType === "revolute" || joint.motionType === "slider"
                                    return (
                                        <ListItem
                                            key={joint.jointGuid}
                                            sx={{ pl: 2, pr: 1, py: 0.25 }}
                                            secondaryAction={
                                                isConfigurable ? (
                                                    <IconButton
                                                        size="small"
                                                        edge="end"
                                                        disabled={editingLocked}
                                                        onClick={() => handleConfigureJoint(asm, joint)}
                                                        sx={{ color: "text.secondary" }}
                                                    >
                                                        <FaGear size={12} />
                                                    </IconButton>
                                                ) : undefined
                                            }
                                        >
                                            <ListItemText
                                                primary={
                                                    <Stack direction="row" alignItems="center" gap={0.75}>
                                                        <Typography variant="caption" noWrap sx={{ maxWidth: 110 }}>
                                                            {joint.name}
                                                        </Typography>
                                                        <Chip
                                                            label={joint.motionType}
                                                            size="small"
                                                            color={
                                                                joint.motionType === "revolute" ? "primary"
                                                                : joint.motionType === "slider" ? "secondary"
                                                                : "default"
                                                            }
                                                            variant="outlined"
                                                            sx={{ height: 18, fontSize: "0.6rem" }}
                                                        />
                                                        {joint.hasMotor && (
                                                            <Chip
                                                                label="motor"
                                                                size="small"
                                                                color="success"
                                                                variant="filled"
                                                                sx={{ height: 18, fontSize: "0.6rem" }}
                                                            />
                                                        )}
                                                    </Stack>
                                                }
                                            />
                                        </ListItem>
                                    )
                                })}
                            </List>
                        )}

                        {asm.rigidNodes.length === 0 && asm.joints.length === 0 && (
                            <Typography variant="caption" sx={{ color: "text.disabled", pl: 2 }}>
                                Empty assembly
                            </Typography>
                        )}
                    </AccordionDetails>
                </Accordion>
            ))}
        </Stack>
    )
}

export default OvenTrayPanel
