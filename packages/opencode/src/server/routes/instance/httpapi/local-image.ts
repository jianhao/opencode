import { Global } from "@opencode-ai/core/global"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { readFile, realpath, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Serves local image files so the renderer can display screenshots and other
// on-disk images. The renderer can't load `file://` directly (Chromium + CSP),
// so it rewrites those references to this route, which is allowed via the
// loopback entries in the CSP `img-src` list.
//
// This route is intentionally unauthenticated (an `<img>` tag can't send the
// Authorization header). Exposure is bounded by:
//   - loopback binding (the desktop server listens on 127.0.0.1),
//   - a path allowlist: only the system temp dir and the opencode data dir,
//   - image extensions only,
//   - a size cap.
const MAX_BYTES = 15 * 1024 * 1024

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
}

// Resolve roots with realpath: on macOS `os.tmpdir()` is `/var/...` but the real
// path is `/private/var/...`, so a plain prefix check against `os.tmpdir()` would
// reject every temp file.
async function roots() {
  return Promise.all(
    [os.tmpdir(), Global.Path.data].map(async (item) => {
      const resolved = path.resolve(item)
      try {
        return await realpath(resolved)
      } catch {
        return resolved
      }
    }),
  )
}

function inside(target: string, root: string) {
  const rel = path.relative(root, target)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

const load = (raw: string) =>
  Effect.tryPromise(async (): Promise<{ body: Uint8Array; mime: string } | undefined> => {
    if (!path.isAbsolute(raw)) return
    const target = await realpath(path.resolve(raw))
    const allowed = await roots()
    if (!allowed.some((root) => inside(target, root))) return
    const mime = MIME[path.extname(target).toLowerCase()]
    if (!mime) return
    const info = await stat(target)
    if (!info.isFile() || info.size > MAX_BYTES) return
    return { body: await readFile(target), mime }
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))

// The route is unauthenticated, so it must only answer loopback callers —
// otherwise `opencode serve --hostname 0.0.0.0` would expose local images on the
// LAN. When the platform doesn't report a remote address we allow (desktop binds
// loopback anyway).
function isLoopback(address: string) {
  const value = address.trim().toLowerCase()
  return (
    value === "localhost" || value === "::1" || value === "::ffff:127.0.0.1" || value.startsWith("127.")
  )
}

export const localImageRoute = HttpRouter.use((router) =>
  router.add("GET", "/file/raw", (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const remote = request.remoteAddress
      if (Option.isSome(remote) && !isLoopback(remote.value)) {
        return HttpServerResponse.text("forbidden", { status: 403 })
      }
      const raw = new URL(request.url, "http://localhost").searchParams.get("path")
      if (!raw) return HttpServerResponse.text("missing path", { status: 400 })
      const loaded = yield* load(raw)
      if (!loaded) return HttpServerResponse.text("not found", { status: 404 })
      // `sandbox` + `default-src 'none'` neutralizes scripts if an SVG is opened
      // directly as a document (it still renders fine inside an <img>).
      const headers: Record<string, string> = {
        "content-type": loaded.mime,
        "cache-control": "private, max-age=60",
      }
      if (loaded.mime === "image/svg+xml") headers["content-security-policy"] = "default-src 'none'; sandbox"
      return HttpServerResponse.raw(loaded.body, { headers })
    }),
  ),
)
