import { usePlatform } from "@/runtime/platform/platform"
import type { WorkbenchBridge } from "./types"

/**
 * The web build has no main process, so `workbench` is absent there and the view renders a
 * "desktop only" state instead of calling a missing bridge.
 */
export function useWorkbench(): WorkbenchBridge | undefined {
  return usePlatform().workbench
}
