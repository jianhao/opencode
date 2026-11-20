import { join } from "node:path"
import { stopDevDesktop } from "./dev-service"

await stopDevDesktop(join(import.meta.dirname, "../../.."))
