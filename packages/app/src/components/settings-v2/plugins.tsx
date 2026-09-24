import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { RadioGroupV2, RadioItemV2 } from "@opencode-ai/ui/v2/radio-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import "./settings-v2.css"

type Policy = "auto" | "notify" | "off"

function pluginName(spec: string) {
  const at = spec.lastIndexOf("@")
  return at > 0 ? spec.slice(0, at) : spec
}

function policyFromValue(value: boolean | "notify" | undefined): Policy {
  if (value === false) return "off"
  if (value === "notify") return "notify"
  return "auto"
}

function valueFromPolicy(policy: Policy): boolean | "notify" {
  if (policy === "off") return false
  if (policy === "notify") return "notify"
  return true
}

export const SettingsPluginsV2: Component = () => {
  const language = useLanguage()
  const serverSync = useServerSync()
  const [selected, setSelected] = createSignal<string>()

  const specs = createMemo(() =>
    (serverSync().data.config.plugin ?? []).map((item) => (typeof item === "string" ? item : item[0])),
  )
  const settings = createMemo(() => serverSync().data.config.plugin_settings ?? {})
  const current = createMemo(() => selected() ?? specs()[0])

  // 本地乐观覆盖：开关/单选框先立即反映，再写回配置。配置写回会触发服务端实例重建，
  // 若等 round-trip 再更新受控值，操作会明显卡一下。
  const [local, setLocal] = createStore<Record<string, { enabled?: boolean; autoupdate?: boolean | "notify" }>>({})
  const settingFor = (spec: string) => ({ ...settings()[spec], ...local[spec] })

  const patch = (spec: string, next: { enabled?: boolean; autoupdate?: boolean | "notify" }) => {
    const merged = { ...settings()[spec], ...local[spec], ...next }
    setLocal(spec, merged)
    void serverSync().updateConfig({ plugin_settings: { ...settings(), [spec]: merged } })
  }

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--compact">
        <h2 class="settings-v2-tab-title">{language.t("status.popover.tab.plugins")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-plugins">
        <Show
          when={specs().length > 0}
          fallback={
            <div class="settings-v2-plugins-empty">{language.t("dialog.plugins.empty")}</div>
          }
        >
          <div class="settings-v2-plugins-list">
            <For each={specs()}>
              {(spec) => (
                <div
                  class="settings-v2-plugin-item"
                  classList={{ "settings-v2-plugin-item--active": current() === spec }}
                  onClick={() => setSelected(spec)}
                >
                  <div class="settings-v2-plugin-item-main">
                    <span class="settings-v2-plugin-name">{pluginName(spec)}</span>
                    <span class="settings-v2-plugin-spec">{spec}</span>
                  </div>
                  <div onClick={(event) => event.stopPropagation()}>
                    <Switch
                      checked={settingFor(spec)?.enabled !== false}
                      onChange={(checked) => {
                        patch(spec, { enabled: checked })
                        setSelected(spec)
                      }}
                    />
                  </div>
                </div>
              )}
            </For>
          </div>

          <div class="settings-v2-plugins-detail">
            <Show when={current()}>{(spec) => <PluginDetail spec={spec()} />}</Show>
          </div>
        </Show>
      </div>
    </>
  )

  function PluginDetail(props: { spec: string }) {
    const spec = () => props.spec
    const enabled = () => settingFor(spec())?.enabled !== false
    return (
      <div class="settings-v2-plugin-detail">
        <div class="settings-v2-plugin-detail-name">{pluginName(spec())}</div>

        <div class="settings-v2-plugin-detail-row">
          <span class="settings-v2-plugin-detail-label">
            {language.t("settings.general.row.pluginEnabled.title")}
          </span>
          <Switch checked={enabled()} onChange={(checked) => patch(spec(), { enabled: checked })} />
        </div>

        <div class="settings-v2-plugin-detail-row">
          <span class="settings-v2-plugin-detail-label">
            {language.t("settings.general.row.pluginAutoUpdate.title")}
          </span>
          <RadioGroupV2
            value={policyFromValue(settingFor(spec())?.autoupdate)}
            onChange={(value) => patch(spec(), { autoupdate: valueFromPolicy(value as Policy) })}
          >
            <RadioItemV2 value="auto" label={language.t("settings.general.row.pluginAutoUpdate.auto")} />
            <RadioItemV2 value="notify" label={language.t("settings.general.row.pluginAutoUpdate.notify")} />
            <RadioItemV2 value="off" label={language.t("settings.general.row.pluginAutoUpdate.off")} />
          </RadioGroupV2>
        </div>
      </div>
    )
  }
}
