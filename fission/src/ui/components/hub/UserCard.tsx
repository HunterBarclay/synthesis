import { Box, BoxProps } from "@mui/material"
import UserIcon from "../UserIcon"
import { useEffect, useState } from "react"
import APS, { APS_USER_INFO_UPDATE_EVENT } from "@/aps/APS"
import { Button, SynthesisIcons } from "../StyledComponents"
import APSManagementModal from "@/ui/modals/APSManagementModal"
import { useUIContext } from "@/ui/helpers/UIProviderHelpers"

const UserCard: React.FC<BoxProps> = (props) => {
    const { openModal } = useUIContext()

    const [userInfo, setUserInfo] = useState(APS.userInfo)

    useEffect(() => {
        const onAPSUserInfoUpdate = () => {
            setUserInfo(APS.userInfo)
        }

        document.addEventListener(APS_USER_INFO_UPDATE_EVENT, onAPSUserInfoUpdate)
        return () => {
            document.removeEventListener(APS_USER_INFO_UPDATE_EVENT, onAPSUserInfoUpdate)
        }
    }, [])

    return (
        <Box {...props}>
            {userInfo ? (
                <Button
                    startIcon={<UserIcon className="h-6 rounded-full" />}
                    className="relative flex flex-row"
                    variant="contained"
                    sx={{
                        "&:focus": {
                            outline: "none",
                        },
                    }}
                    onClick={() => openModal(APSManagementModal, undefined)}
                >
                    <span>{userInfo.givenName}</span>
                </Button>
            ) : (
                <Button
                    startIcon={SynthesisIcons.PEOPLE}
                    className="relative flex flex-row"
                    variant="contained"
                    sx={{
                        "&:focus": {
                            outline: "none",
                        },
                    }}
                    onClick={() => APS.requestAuthCode()}
                >
                    <span>Login</span>
                </Button>
            )}
        </Box>
    )
}

export default UserCard
