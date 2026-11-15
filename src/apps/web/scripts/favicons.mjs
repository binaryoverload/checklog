// Renders the Apple touch icon from public/icon.svg. Run with `pnpm --filter @checklog/web favicons` after changing the icon.
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const publicDir = fileURLToPath(new URL("../public/", import.meta.url))
const source = `${publicDir}icon.svg`

// The tab icon is transparent; iOS fills transparency with black, so the touch icon sits on a dark tile instead
const appleSize = 180
const appleIconSize = 124
const appleBackground = "#161b1d"

const appleIcon = await sharp(source)
  .resize(appleIconSize, appleIconSize)
  .png()
  .toBuffer()

await sharp({ create: { width: appleSize, height: appleSize, channels: 4, background: appleBackground } })
  .composite([{ input: appleIcon }])
  .png()
  .toFile(`${publicDir}apple-touch-icon.png`)

console.log("Wrote apple-touch-icon.png")
