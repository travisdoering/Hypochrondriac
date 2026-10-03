import { appIcon } from "@/lib/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iPhone / iPad ("Add to Home Screen"). */
export default function AppleIcon() {
  return appIcon(180);
}
