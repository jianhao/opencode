// Lets the host app teach the renderer how to turn local image references into a
// loadable URL. Local `file://` / absolute paths can't be loaded by the renderer
// directly (CSP + Chromium block local resources), so the desktop points these at
// the opencode server's `/file/raw` route, which serves allowlisted local images.
type ImageResolver = (src: string) => string

let resolver: ImageResolver | undefined

export function setImageResolver(fn: ImageResolver | undefined) {
  resolver = fn
}

export function resolveImageSrc(src: string) {
  if (!src || !resolver) return src
  try {
    return resolver(src) || src
  } catch {
    return src
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

function toLocalPath(value: string): string | undefined {
  if (value.startsWith("file:")) {
    try {
      const url = new URL(value)
      let file = decodeURIComponent(url.pathname)
      // file:///C:/x -> /C:/x -> C:/x (Windows drive)
      if (/^\/[A-Za-z]:[\\/]/.test(file)) file = file.slice(1)
      // file://server/share -> //server/share (UNC)
      if (url.hostname && url.hostname !== "localhost") file = `//${url.hostname}${file}`
      return file
    } catch {
      return undefined
    }
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) return value // Windows absolute: C:\ or C:/
  if (value.startsWith("/") || value.startsWith("\\\\")) return value // POSIX absolute / UNC
  return undefined
}

// Returns a loopback URL for a local image reference, or the input unchanged.
export function localImageUrl(src: string, origin: string) {
  const file = toLocalPath(src.trim())
  if (!file || !IMAGE_EXT.test(file)) return src
  return `${origin.replace(/\/+$/, "")}/file/raw?path=${encodeURIComponent(file)}`
}
