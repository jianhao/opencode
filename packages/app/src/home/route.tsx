import { createMediaQuery } from "@solid-primitives/media"
import { Show } from "solid-js"
import { usePlatform } from "@/runtime/platform/platform"
import { useSettings } from "@/settings/model"
import { createWorkbenchController } from "@/workbench/model"
import { WorkbenchView } from "@/workbench/view"
import { createHomeController } from "./model"
import { HomeNavigation } from "./navigation"
import { createHomeProjectsController } from "./projects/controller"
import { createHomeSessionsController } from "./sessions/controller"

export function Home() {
  const mobile = createMediaQuery("(max-width: 900px)")
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const platform = usePlatform()
  const settings = useSettings()
  const workbench = createWorkbenchController(() => platform.workbench)
  const usesShellSidebar = () => !mobile() && settings.appearance.tabLayout() !== "horizontal"

  return (
    <div
      data-slot="home-panel"
      class="mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
    >
      <div class="home-workbench-frame" data-shell-sidebar={usesShellSidebar() ? "" : undefined}>
        <Show when={!usesShellSidebar()}>
          <HomeNavigation projects={projects} sessions={sessions} mobile={mobile()} onWorkbench={() => undefined} />
        </Show>
        <section class="home-workbench-content" aria-label="工作台">
          <WorkbenchView controller={workbench} desktop={platform.platform === "desktop"} />
        </section>
      </div>
    </div>
  )
}
