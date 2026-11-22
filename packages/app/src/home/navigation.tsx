import { createMemo, createSignal, For, Show } from "solid-js"
import {
  displayName,
  getProjectAvatarGenerated,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { pathKey } from "@/workspaces/path-key"
import { sessionLabel } from "@/session/title"
import type { HomeProjectsController } from "./projects/controller"
import type { HomeSessionsController } from "./sessions/controller"
import "./navigation.css"

const RECENT_LIMIT = 3

export function HomeNavigation(props: {
  projects: HomeProjectsController
  sessions: HomeSessionsController
  mobile: boolean
  onWorkbench: () => void
}) {
  const [expanded, setExpanded] = createSignal(new Set<string>())
  const [showAll, setShowAll] = createSignal(new Set<string>())

  const groups = createMemo(() => {
    const records = props.sessions.data.navigationRecords()

    return props.projects.project.list().map((project) => {
      const key = pathKey(project.worktree)

      return {
        project,
        key,
        sessions: records.filter((record) => pathKey(record.project.worktree) === key),
      }
    })
  })

  const toggle = (set: () => Set<string>, update: (next: Set<string>) => void, key: string) => {
    const next = new Set(set())

    if (next.has(key)) next.delete(key)
    else next.add(key)
    update(next)
  }

  return (
    <aside class="home-navigation" data-mobile={props.mobile ? "" : undefined} aria-label="工作台导航">
      <div class="home-navigation-main">
        <button
          type="button"
          class="home-navigation-item"
          data-active=""
          data-action="home-open-workbench"
          onClick={props.onWorkbench}
        >
          <Icon name="layout-left" />
          <span>工作台</span>
        </button>

        <div class="home-navigation-heading">
          <span>项目</span>
          <Show when={props.projects.server.list()[0]}>
            {(server) => (
              <IconButton
                data-action="home-add-project"
                variant="ghost-muted"
                size="small"
                icon={<Icon name="folder-add-left" />}
                aria-label="添加项目"
                onClick={() => props.projects.project.choose(server())}
              />
            )}
          </Show>
        </div>

        <div class="home-navigation-projects">
          <For each={groups()}>
            {(group) => {
              const open = () => expanded().has(group.key)
              const all = () => showAll().has(group.key)
              const visible = () => (all() ? group.sessions : group.sessions.slice(0, RECENT_LIMIT))

              return (
                <section class="home-navigation-project" data-open={open() ? "" : undefined}>
                  <button
                    type="button"
                    class="home-navigation-project-trigger"
                    aria-expanded={open()}
                    onClick={() => toggle(expanded, setExpanded, group.key)}
                  >
                    <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
                    <ProjectAvatar
                      class="home-navigation-avatar"
                      fallback={displayName(group.project)}
                      src={getProjectAvatarSource(group.project.id, group.project.icon)}
                      variant={getProjectAvatarVariant(group.project.icon?.color)}
                      generated={getProjectAvatarGenerated(group.project)}
                    />
                    <span class="home-navigation-project-name">{displayName(group.project)}</span>
                    <span class="home-navigation-count">{group.sessions.length}</span>
                  </button>

                  <Show when={open()}>
                    <div class="home-navigation-sessions">
                      <For each={visible()}>
                        {(record) => (
                          <button
                            type="button"
                            class="home-navigation-session"
                            data-open={props.sessions.tab.isOpen(record) ? "" : undefined}
                            onClick={() => props.sessions.session.open(record.session)}
                          >
                            <span>{sessionLabel(record.session)}</span>
                          </button>
                        )}
                      </For>
                      <Show when={group.sessions.length === 0}>
                        <div class="home-navigation-empty">暂无会话</div>
                      </Show>
                      <Show when={group.sessions.length > RECENT_LIMIT}>
                        <button
                          type="button"
                          class="home-navigation-more"
                          onClick={() => toggle(showAll, setShowAll, group.key)}
                        >
                          {all() ? "收起会话" : `查看更多会话 · ${group.sessions.length - RECENT_LIMIT}`}
                        </button>
                      </Show>
                    </div>
                  </Show>
                </section>
              )
            }}
          </For>
        </div>
      </div>

      <div class="home-navigation-footer">
        <button type="button" onClick={props.projects.utility.settings}>
          <Icon name="settings-gear" size="small" />
          <span>设置</span>
        </button>
        <button type="button" onClick={props.projects.utility.help}>
          <Icon name="help" size="small" />
          <span>帮助</span>
        </button>
      </div>
    </aside>
  )
}
