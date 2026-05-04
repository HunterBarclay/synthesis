import { Stack, LinearProgress, Slider, Typography } from "@mui/material"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "./StyledComponents"
import { IoPlayOutline, IoPauseOutline } from "react-icons/io5"
import { BiReset } from "react-icons/bi"
import { IoMdAdd } from "react-icons/io"
import { useUIContext } from "@/ui/helpers/UIProviderHelpers"
import ImportPrototypeModal from "@/ui/modals/mirabuf/ImportPrototypeModal"

const RECORDER_FRAMERATE = 60

const OvenActionBar: React.FC = () => {
    const { openModal } = useUIContext()

    const [simulating, setSimulating] = useState(false)
    const [progress, setProgress] = useState(0)
    const [totalFrames, setTotalFrames] = useState(0)
    const [scrubValue, setScrubValue] = useState(0)
    const [playing, setPlaying] = useState(false)

    const playRef = useRef(false)
    const scrubRef = useRef(0)
    const totalFramesRef = useRef(0)
    const rafRef = useRef(0)

    useEffect(() => {
        totalFramesRef.current = totalFrames
    }, [totalFrames])

    useEffect(() => {
        const onResult = (e: Event) => {
            const detail = (e as CustomEvent).detail
            if (detail?.action === "simulateDone") {
                setSimulating(false)
                setProgress(0)
                const frames = detail.totalFrames as number
                if (frames > 0) {
                    setTotalFrames(frames)
                    setScrubValue(100)
                    scrubRef.current = 100
                }
            } else if (detail?.action === "progress") {
                const pct = ((detail.completedSteps as number) / (detail.totalSteps as number)) * 100
                setProgress(pct)
            } else if (detail?.action === "error") {
                setSimulating(false)
                setProgress(0)
            }
        }
        window.addEventListener("ovenResult", onResult)
        return () => window.removeEventListener("ovenResult", onResult)
    }, [])

    const dispatchScrub = useCallback((v: number) => {
        window.dispatchEvent(new CustomEvent("ovenAction", { detail: { action: "scrub", t: v / 100 } }))
    }, [])

    const stopPlayback = useCallback(() => {
        playRef.current = false
        setPlaying(false)
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
        }
    }, [])

    const startPlayback = useCallback(() => {
        if (totalFramesRef.current < 2) return

        let startScrub = scrubRef.current
        if (startScrub >= 100) startScrub = 0

        scrubRef.current = startScrub
        setScrubValue(startScrub)
        dispatchScrub(startScrub)

        playRef.current = true
        setPlaying(true)

        const durationMs = ((totalFramesRef.current - 1) / RECORDER_FRAMERATE) * 1000
        let lastTime: number | undefined

        const tick = (now: number) => {
            if (!playRef.current) return

            if (lastTime === undefined) {
                lastTime = now
                rafRef.current = requestAnimationFrame(tick)
                return
            }

            const dt = now - lastTime
            lastTime = now

            const increment = (dt / durationMs) * 100
            const next = Math.min(scrubRef.current + increment, 100)
            scrubRef.current = next
            setScrubValue(next)
            dispatchScrub(next)

            if (next >= 100) {
                stopPlayback()
                return
            }

            rafRef.current = requestAnimationFrame(tick)
        }

        rafRef.current = requestAnimationFrame(tick)
    }, [dispatchScrub, stopPlayback])

    const handlePlayPause = useCallback(() => {
        if (playing) {
            stopPlayback()
        } else {
            startPlayback()
        }
    }, [playing, stopPlayback, startPlayback])

    const handleSimulate = () => {
        stopPlayback()
        setSimulating(true)
        setTotalFrames(0)
        setScrubValue(0)
        scrubRef.current = 0
        window.dispatchEvent(new CustomEvent("ovenAction", { detail: { action: "simulate" } }))
    }

    const handleReset = () => {
        stopPlayback()
        setTotalFrames(0)
        setScrubValue(0)
        scrubRef.current = 0
        window.dispatchEvent(new CustomEvent("ovenAction", { detail: { action: "reset" } }))
    }

    const handleScrub = useCallback((_: Event, value: number | number[]) => {
        console.debug(value)
        const v = typeof value === "number" ? value : value[0]
        stopPlayback()
        setScrubValue(v)
        scrubRef.current = v
        dispatchScrub(v)
    }, [stopPlayback, dispatchScrub])

    const hasRecording = totalFrames > 0

    useEffect(() => {
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
        }
    }, [])

    return (
        <Stack
            className="select-none absolute bottom-4 left-1/2 -translate-x-1/2 py-2 px-4 rounded-xl gap-3"
            direction="column"
            alignItems="center"
            sx={{
                bgcolor: "background.paper",
                boxShadow: 8,
                minWidth: (hasRecording || simulating) ? 480 : undefined,
            }}
        >
            {simulating && (
                <Stack direction="column" gap={0.5} className="w-full px-2">
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        Baking… {Math.round(progress)}%
                    </Typography>
                    <LinearProgress
                        variant="determinate"
                        value={progress}
                        sx={{ width: "100%", borderRadius: 1 }}
                    />
                </Stack>
            )}
            {hasRecording && !simulating && (
                <Stack direction="row" alignItems="center" gap={2} className="w-full px-2">
                    <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
                        Frame {Math.round(scrubValue / 100 * (totalFrames - 1))}/{totalFrames - 1}
                    </Typography>
                    <Slider
                        value={scrubValue}
                        onChange={handleScrub}
                        min={0}
                        max={100}
                        step={0.1}
                        size="small"
                        sx={{ flex: 1 }}
                    />
                </Stack>
            )}
            <Stack direction="row" gap={1.5}>
                <Button
                    variant="outlined"
                    disabled={simulating || hasRecording}
                    onClick={() => openModal(ImportPrototypeModal, {})}
                    startIcon={<IoMdAdd />}
                >
                    Add Assembly
                </Button>
                {hasRecording && !simulating ? (
                    <Button
                        variant="contained"
                        color="success"
                        onClick={handlePlayPause}
                        startIcon={playing ? <IoPauseOutline /> : <IoPlayOutline />}
                    >
                        {playing ? "Pause" : "Play"}
                    </Button>
                ) : (
                    <Button
                        variant="contained"
                        color="success"
                        disabled={simulating}
                        onClick={handleSimulate}
                        startIcon={<IoPlayOutline />}
                    >
                        {simulating ? "Baking…" : "Simulate 10s"}
                    </Button>
                )}
                <Button
                    variant="outlined"
                    color="error"
                    disabled={simulating}
                    onClick={handleReset}
                    startIcon={<BiReset />}
                >
                    Reset
                </Button>
            </Stack>
        </Stack>
    )
}

export default OvenActionBar
