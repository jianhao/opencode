import { createMediaQuery } from "@solid-primitives/media"
import { createEffect, createSignal, Show } from "solid-js"
import { usePlatform } from "@/runtime/platform/platform"
import { useSettings } from "@/settings/model"
import { useLayout } from "@/shell/state/layout"
import { createWorkbenchController } from "@/workbench/model"
import { createWorkbenchRuns } from "@/workbench/runs"
import { WorkbenchView } from "@/workbench/view"
import { createHomeController } from "./model"
import { HomeNavigation } from "./navigation"
import { createHomeProjectsController } from "./projects/controller"
import { createHomeSessionsController } from "./sessions/controller"

const HOME_NAV_MIN = 180

const HOME_NAV_MAX = 480

export function Home() {
  const mobile = createMediaQuery("(max-width: 900px)")
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const platform = usePlatform()
  const settings = useSettings()
  const layout = useLayout()
  const clampNav = (width: number) => Math.min(Math.max(width, HOME_NAV_MIN), HOME_NAV_MAX)
  const [navWidth, setNavWidth] = createSignal(clampNav(layout.sidebar.homeWidth()))

  // 布局是异步恢复的，水合完成后把上次拖的宽度带回来。
  createEffect(() => {
    if (!layout.ready()) return

    setNavWidth(clampNav(layout.sidebar.homeWidth()))
  })
  const workbench = createWorkbenchController(() => platform.workbench)
  const runs = createWorkbenchRuns(home, () => platform.workbench)
  const usesShellSidebar = () => !mobile() && settings.appearance.tabLayout() !== "horizontal"

  return (
    <div
      data-slot="home-panel"
      class="mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
    >
      <div
        class="home-workbench-frame"
        data-shell-sidebar={usesShellSidebar() ? "" : undefined}
        style={
          usesShellSidebar() || mobile() ? undefined : { "grid-template-columns": `${navWidth()}px minmax(0, 1fr)` }
        }
      >
        <Show when={!usesShellSidebar()}>
          <HomeNavigation
            projects={projects}
            sessions={sessions}
            mobile={mobile()}
            onWorkbench={() => undefined}
            width={navWidth()}
            min={HOME_NAV_MIN}
            max={HOME_NAV_MAX}
            onResize={setNavWidth}
            onResizeEnd={() => layout.sidebar.resizeHome(navWidth())}
          />
        </Show>
        <section class="home-workbench-content" aria-label="工作台">
          <WorkbenchView controller={workbench} runs={runs} desktop={platform.platform === "desktop"} />
        </section>
      </div>
    </div>
  )
}
