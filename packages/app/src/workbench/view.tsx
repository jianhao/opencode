import { For, Show, createMemo, createSignal } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import type { WorkbenchDetail, WorkbenchItem } from "./types"
import type { createWorkbenchController } from "./model"
import { statusTone, type StatusTone } from "./status-tone"
import "./view.css"

type Controller = ReturnType<typeof createWorkbenchController>

const READINESS: Record<WorkbenchItem["readiness"], string> = {
  ready: "可做",
  clarify: "需澄清",
  blocked: "阻塞",
}

const CATEGORY: Record<WorkbenchItem["category"], string> = {
  Req: "需求",
  Task: "任务",
  Bug: "缺陷",
  Other: "其他",
}

function relative(value?: string) {
  if (!value) return ""
  const delta = Date.now() - new Date(value).getTime()

  if (Number.isNaN(delta)) return ""
  const minutes = Math.round(delta / 60000)

  if (minutes < 60) return `${Math.max(minutes, 1)} 分钟前`
  const hours = Math.round(minutes / 60)

  if (hours < 24) return `${hours} 小时前`

  return `${Math.round(hours / 24)} 天前`
}

function priorityClass(priority?: string) {
  if (priority === "P0") return "text-v2-state-fg-danger"

  if (priority === "P1") return "text-v2-state-fg-warning"

  return "text-v2-text-text-muted"
}

export function WorkbenchView(props: { controller: Controller; desktop: boolean }) {
  const snapshot = () => props.controller.snapshot()
  const total = () => snapshot()?.counts.total ?? 0
  const selected = createMemo(() => props.controller.items().find((item) => item.id === props.controller.selected()))
  const [tokenInput, setTokenInput] = createSignal("")
  const [configOpen, setConfigOpen] = createSignal(false)
  const configured = () => props.desktop && snapshot()?.token.configured

  return (
    <div class="workbench-shell">
      <header class="workbench-header">
        <div class="workbench-title">
          <h1>工作台</h1>
          <p>聚合当前需要推进、澄清或解除阻塞的事项</p>
        </div>
        <div class="workbench-header-spacer" />
        <Show when={snapshot()?.token.configured}>
          <span class="workbench-sync">
            <i />
            <span>{snapshot()?.token.userName}</span>
            <span>·</span>
            <span>{relative(new Date(snapshot()!.fetchedAt).toISOString())}</span>
          </span>
        </Show>
        <Show when={configured()}>
          <label class="workbench-search">
            <Icon name="magnifying-glass" size="small" />
            <input
              value={props.controller.query()}
              placeholder="搜索云效号 / 标题 / 项目"
              onInput={(event) => props.controller.setQuery(event.currentTarget.value)}
            />
            <span>{props.controller.items().length}</span>
          </label>
        </Show>
        <IconButton
          icon={<Icon name="refresh" />}
          variant="neutral"
          aria-label="刷新工作台"
          disabled={!configured() || props.controller.loading()}
          onClick={() => void props.controller.refresh()}
        />
        <IconButton
          icon={<Icon name="sliders" />}
          variant="ghost-muted"
          aria-label="配置状态标签"
          aria-expanded={configOpen()}
          disabled={!configured()}
          onClick={() => setConfigOpen((open) => !open)}
        />
        <Show when={configOpen()}>
          <div class="workbench-config-backdrop" onClick={() => setConfigOpen(false)} />
          <StatusConfig controller={props.controller} onClose={() => setConfigOpen(false)} />
        </Show>
      </header>

      <Show when={!props.desktop}>
        <WorkbenchEmpty title="工作台只在桌面端可用" detail="Web 版无法读取本地云效连接。" />
      </Show>

      <Show when={props.desktop && snapshot() && !snapshot()!.token.configured}>
        <div class="workbench-setup">
          <div class="workbench-setup-icon">
            <Icon name="keyboard" />
          </div>
          <div>
            <strong>连接云效</strong>
            <p>在 shell 中设置云效令牌，或粘贴一个只读令牌。</p>
          </div>
          <div class="workbench-setup-form">
            <input
              type="password"
              placeholder="云效访问令牌"
              value={tokenInput()}
              onInput={(event) => setTokenInput(event.currentTarget.value)}
            />
            <button
              type="button"
              disabled={!tokenInput().trim()}
              onClick={() => void props.controller.saveToken(tokenInput().trim())}
            >
              保存
            </button>
          </div>
        </div>
      </Show>

      <Show when={props.desktop && snapshot()?.error}>{(error) => <div class="workbench-error">{error()}</div>}</Show>

      <Show when={configured() && snapshot() && !snapshot()!.error}>
        <div class="workbench-filters" role="tablist" aria-label="工作项筛选">
          <Filter
            value={total()}
            label="全部"
            status="all"
            tone="default"
            active={props.controller.filter() === "all"}
            onClick={() => props.controller.setFilter("all")}
          />
          <For each={props.controller.visibleStatuses()}>
            {(status) => (
              <Filter
                value={status.count}
                label={status.name}
                status={status.name}
                tone={status.tone}
                active={props.controller.filter() === status.name}
                onClick={() => props.controller.setFilter(status.name)}
              />
            )}
          </For>
        </div>

        <div class="workbench-content">
          <div class="workbench-grid-scroll" data-scrollable>
            <Show when={props.controller.loading() && !snapshot()}>
              <WorkbenchEmpty title="正在读取云效" detail="首次加载可能需要几秒。" />
            </Show>
            <Show when={!props.controller.loading() && props.controller.items().length === 0}>
              <WorkbenchEmpty title="当前筛选下没有工作项" detail="切换状态筛选或检查云效令牌。" />
            </Show>
            <div class="workbench-grid">
              <For each={props.controller.items()}>
                {(item) => (
                  <Card
                    item={item}
                    active={item.id === props.controller.selected()}
                    onClick={() => props.controller.open(item)}
                  />
                )}
              </For>
            </div>
          </div>

          <Show when={selected()}>
            {(item) => (
              <>
                <div class="workbench-drawer-backdrop" onClick={props.controller.close} />
                <aside class="workbench-detail" role="dialog" aria-modal="true" aria-label="工作项详情" data-scrollable>
                  <Show
                    when={!props.controller.detailLoading() && props.controller.detail()}
                    fallback={<DetailPlaceholder item={item()} onClose={props.controller.close} />}
                  >
                    {(detail) => <Detail detail={detail()} onClose={props.controller.close} />}
                  </Show>
                </aside>
              </>
            )}
          </Show>
        </div>
      </Show>

      <Show when={props.desktop && snapshot()?.warnings.length}>
        <div class="workbench-warning">部分项目空间拉取失败：{snapshot()!.warnings.length} 项</div>
      </Show>
    </div>
  )
}

function Filter(props: {
  value: number
  label: string
  status: string
  tone: StatusTone
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      class="workbench-filter"
      data-status={props.status}
      data-status-tone={props.tone}
      aria-selected={props.active}
      onClick={props.onClick}
    >
      <b>{props.value}</b>
      <span>{props.label}</span>
    </button>
  )
}

function StatusConfig(props: { controller: Controller; onClose: () => void }) {
  return (
    <div class="workbench-config" role="dialog" aria-label="配置状态标签">
      <header>
        <div>
          <strong>状态标签</strong>
          <span>控制顶部显示哪些云效状态</span>
        </div>
        <IconButton
          icon={<Icon name="xmark-small" />}
          variant="ghost-muted"
          size="small"
          aria-label="关闭配置"
          onClick={props.onClose}
        />
      </header>
      <div class="workbench-config-sort">
        <span>排序</span>
        <button
          type="button"
          aria-pressed={props.controller.statusSort() === "count"}
          onClick={() => props.controller.setStatusSort("count")}
        >
          数量
        </button>
        <button
          type="button"
          aria-pressed={props.controller.statusSort() === "name"}
          onClick={() => props.controller.setStatusSort("name")}
        >
          名称
        </button>
      </div>
      <MenuScroll class="workbench-config-scroll" viewportClass="workbench-config-list">
        <For each={props.controller.statuses()}>
          {(status) => {
            const visible = () => !props.controller.hiddenStatuses().has(status.name)

            return (
              <button
                type="button"
                data-status-tone={status.tone}
                aria-pressed={visible()}
                onClick={() => props.controller.toggleStatus(status.name)}
              >
                <span class="workbench-config-check">
                  <Show when={visible()}>
                    <Icon name="check" size="small" />
                  </Show>
                </span>
                <span>{status.name}</span>
                <em>{status.count}</em>
              </button>
            )
          }}
        </For>
      </MenuScroll>
    </div>
  )
}

function Card(props: { item: WorkbenchItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class="workbench-card"
      data-category={props.item.category}
      data-status-tone={statusTone(props.item.statusName)}
      aria-current={props.active}
      onClick={props.onClick}
    >
      <span class="workbench-card-top">
        <span class="workbench-type">{CATEGORY[props.item.category]}</span>
        <span class="workbench-status">{props.item.statusName}</span>
      </span>
      <span class="workbench-card-title">{props.item.title}</span>
      <span class="workbench-card-meta">
        <code>{props.item.serial}</code>
        <span>·</span>
        <span>{props.item.spaceName}</span>
      </span>
      <span class="workbench-card-foot">
        <Show when={props.item.priority}>
          <span class={priorityClass(props.item.priority)}>{props.item.priority}</span>
        </Show>
        <span class="workbench-card-grow" />
        <span>{relative(props.item.updatedAt)}</span>
      </span>
    </button>
  )
}

function Detail(props: { detail: WorkbenchDetail; onClose: () => void }) {
  const item = () => props.detail.item

  return (
    <div
      class="workbench-detail-inner"
      data-category={item().category}
      data-status-tone={statusTone(item().statusName)}
    >
      <header class="workbench-detail-head">
        <div class="workbench-detail-top">
          <span class="workbench-type">{CATEGORY[item().category]}</span>
          <span class="workbench-status">{item().statusName}</span>
          <span class="workbench-card-grow" />
          <IconButton
            icon={<Icon name="xmark-small" />}
            variant="ghost-muted"
            size="small"
            aria-label="关闭详情"
            onClick={props.onClose}
          />
        </div>
        <h2>{item().title}</h2>
        <div class="workbench-detail-sub">
          <code>{item().serial}</code>
          <span>·</span>
          <span>{item().spaceName}</span>
          <span>·</span>
          <span>{item().statusName}</span>
          <span>·</span>
          <span>{relative(item().updatedAt)}更新</span>
        </div>
      </header>

      <div class="workbench-detail-body">
        <section>
          <h3>概要</h3>
          <div class="workbench-props">
            <Meta label="负责人" value={item().assigneeName} />
            <Meta label="优先级" value={item().priorityName ?? item().priority} />
            <Meta label="类型" value={item().categoryName} />
            <Meta label="处理建议" value={READINESS[item().readiness]} />
          </div>
        </section>

        <section>
          <h3>判断依据</h3>
          <div class="workbench-reasons">
            <For each={item().reasons}>
              {(reason) => (
                <div class="workbench-reason" data-level={reason.level}>
                  <i />
                  <span>{reason.message}</span>
                </div>
              )}
            </For>
          </div>
        </section>

        <Show when={props.detail.description}>
          <section>
            <h3>描述</h3>
            <p class="workbench-prose">{props.detail.description}</p>
          </section>
        </Show>

        <Show when={props.detail.relations.length}>
          <section>
            <h3>关联项</h3>
            <div class="workbench-relations">
              <For each={props.detail.relations}>
                {(relation) => (
                  <div>
                    <code>{relation.serial}</code>
                    <span>{relation.title}</span>
                    <em>{relation.statusName}</em>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={props.detail.comments.length}>
          <section>
            <h3>评论 · {props.detail.comments.length}</h3>
            <div class="workbench-comments">
              <For each={props.detail.comments}>
                {(comment) => (
                  <div>
                    <header>
                      <strong>{comment.author}</strong>
                      <span>{relative(comment.created)}</span>
                    </header>
                    <p>{comment.content}</p>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>
      </div>

      <footer class="workbench-detail-foot">
        <Show when={item().url}>
          {(url) => (
            <a href={url()} target="_blank" rel="noreferrer">
              打开云效
              <Icon name="arrow-up-right" size="small" />
            </a>
          )}
        </Show>
        <span class="workbench-card-grow" />
        <button type="button" disabled title="V2 开放">
          开始处理
        </button>
      </footer>
    </div>
  )
}

function DetailPlaceholder(props: { item: WorkbenchItem; onClose: () => void }) {
  return (
    <div
      class="workbench-detail-inner"
      data-category={props.item.category}
      data-status-tone={statusTone(props.item.statusName)}
    >
      <header class="workbench-detail-head">
        <div class="workbench-detail-top">
          <code>{props.item.serial}</code>
          <span class="workbench-card-grow" />
          <IconButton
            icon={<Icon name="xmark-small" />}
            variant="ghost-muted"
            size="small"
            aria-label="关闭详情"
            onClick={props.onClose}
          />
        </div>
        <h2>{props.item.title}</h2>
      </header>
      <div class="workbench-detail-loading">
        <Loader class="size-3.5" />
        <span>正在读取详情…</span>
      </div>
    </div>
  )
}

function Meta(props: { label: string; value?: string }) {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{props.value ?? "—"}</strong>
    </div>
  )
}

function WorkbenchEmpty(props: { title: string; detail: string }) {
  return (
    <div class="workbench-empty">
      <Icon name="window-analytics" size="large" />
      <strong>{props.title}</strong>
      <span>{props.detail}</span>
    </div>
  )
}
