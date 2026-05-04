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
}

export interface OvenTrayPanelMotor {
    jointGuid: string
    mode: OvenMotorMode
    targetValue: number
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

const OvenTrayPanel: React.FC = () => {
    const { openModal } = useUIContext()
    const [assemblies, setAssemblies] = useState<OvenTrayPanelAssembly[]>([])
    const [editingLocked, setEditingLocked] = useState(false)
    const [gizmo, setGizmo] = useState<GizmoState>({ active: false, assemblyIndex: -1, mode: "translate" })

    useEffect(() => {
        const onResult = (e: Event) => {
            const detail = (e as CustomEvent).detail
            if (detail?.action === "trayUpdated") {
                setAssemblies(detail.assemblies as OvenTrayPanelAssembly[])
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
        })
    }, [editingLocked, openModal])

    const handleRemoveMotor = useCallback((assemblyIndex: number, jointGuid: string) => {
        if (editingLocked) return
        window.dispatchEvent(new CustomEvent("ovenAction", {
            detail: { action: "removeMotor", assemblyIndex, jointGuid },
        }))
    }, [editingLocked])

    const handleConfigureMotor = useCallback((asm: OvenTrayPanelAssembly, motor: OvenTrayPanelMotor) => {
        if (editingLocked) return
        openModal(OvenConfigModal, {
            targetType: "motor",
            assemblyIndex: asm.index,
            assemblyName: asm.name,
            jointGuid: motor.jointGuid,
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

    if (assemblies.length === 0) return null

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
            <Typography
                variant="subtitle2"
                sx={{ px: 2, pt: 1.5, pb: 0.5, color: "text.secondary", textTransform: "uppercase", letterSpacing: 1, fontSize: "0.7rem" }}
            >
                Tray Contents
            </Typography>

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

                        {asm.motors.length > 0 && <Divider sx={{ my: 0.5 }} />}

                        {/* Motors */}
                        {asm.motors.length > 0 && (
                            <>
                                <Typography
                                    variant="caption"
                                    sx={{ pl: 2, color: "text.secondary", fontWeight: 600, textTransform: "uppercase", fontSize: "0.6rem", letterSpacing: 0.5 }}
                                >
                                    Motors
                                </Typography>
                                <List dense disablePadding>
                                    {asm.motors.map(motor => (
                                        <ListItem
                                            key={motor.jointGuid}
                                            sx={{ pl: 2, pr: 1, py: 0.25 }}
                                            secondaryAction={
                                                <Stack direction="row" gap={0}>
                                                    <IconButton
                                                        size="small"
                                                        edge="end"
                                                        disabled={editingLocked}
                                                        onClick={() => handleConfigureMotor(asm, motor)}
                                                        sx={{ color: "text.secondary" }}
                                                    >
                                                        <FaGear size={12} />
                                                    </IconButton>
                                                    <IconButton
                                                        size="small"
                                                        edge="end"
                                                        disabled={editingLocked}
                                                        onClick={() => handleRemoveMotor(asm.index, motor.jointGuid)}
                                                        sx={{ color: "error.main" }}
                                                    >
                                                        <IoTrashBin size={12} />
                                                    </IconButton>
                                                </Stack>
                                            }
                                        >
                                            <ListItemText
                                                primary={
                                                    <Stack direction="row" alignItems="center" gap={0.75}>
                                                        <Typography variant="caption" noWrap sx={{ maxWidth: 120 }}>
                                                            {motor.jointGuid.slice(0, 8)}…
                                                        </Typography>
                                                        <Chip
                                                            label={motor.mode}
                                                            size="small"
                                                            variant="outlined"
                                                            sx={{ height: 18, fontSize: "0.65rem" }}
                                                        />
                                                    </Stack>
                                                }
                                            />
                                        </ListItem>
                                    ))}
                                </List>
                            </>
                        )}

                        {asm.rigidNodes.length === 0 && asm.motors.length === 0 && (
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
