# 图标主题方案

> 目标端：`pier/tools/opencode`（`packages/ui` + `packages/app`）
> 状态：已落地（line / plate 套装、语义 tone、会话标签头像、品牌资源）
> 日期：2026-11-24

## 1. 一句话

图标只表达「这是哪一类对象」，颜色只表达「哪一类语义」；样式整档切换，不靠逐处调色。

## 2. 两套图标样式

`<html data-icon-style>` 决定整档样式，值来自「设置 → 外观 → 图标样式」：

| 值 | 名称 | 表现 | 用途 |
| --- | --- | --- | --- |
| `line` | 线性（默认） | 纯线条，无底色 | 大多数场景，信息密度高 |
| `plate` | 色块 | 线条 + 同色浅底（`color-mix` 12%），2px 内边距用负外边距抵消，不改变 16px 占位 | 需要快速扫视对象类别的导航、标题栏、侧栏 |

旧的三档 `linear / duotone / ink` 已合并为两套，设置读取时自动迁移：`duotone → plate`，`linear / ink → line`
（见 `packages/app/src/settings/model.tsx` 的 `settingsPersistence` 迁移与 `model.test.ts`）。

## 3. 语义色（tone）

- `IconTone = accent | info | success | warning | neutral`，定义在 `packages/ui/src/icons/icon/tones.ts`。
- 图标名 → tone 的映射表在同一个文件里维护（例如 `outline-worktree → success`、`pencil-line → warning`）。
- 颜色只取主题 token：`--v2-icon-icon-accent`、`--v2-state-fg-info/success/warning`、`--v2-icon-icon-muted`。
  不允许硬编码 hex，换主题（含自定义主题）自动跟随。
- 动作类与导航类图标保持中性色，只有「对象类别」图标上色，避免满屏彩色。

## 4. 尺寸与占位

| 尺寸 | 像素 |
| --- | --- |
| `large` | 20 |
| 默认 | 16 |
| `small` | 14 |

`Icon` 组件本身不再按「是否有新稿」切尺寸：`packages/ui/src/icons/new-icons.ts` 覆盖层已删除，
所有图标统一走 `packages/ui/src/icons/catalog`，尺寸只由 `size` 决定。

## 5. 会话标签头像

`packages/app/src/shell/layout/session-tab-avatar.tsx` 不再按项目/目录生成随机图案：
统一 `bubble-5` 图标 + accent 浅底 + 内描边，未读时加一个点和右上角遮罩缺口（见同目录 `.css`）。

## 6. 品牌资源

| 位置 | 内容 |
| --- | --- |
| `packages/identity/mark*.svg` / `mark-*.png` | 应用 mark 与各尺寸 PNG |
| `packages/console/app/src/asset/brand/*` | 官网 / 控制台的明暗版 logo |
| `services/www/public/favicon.svg` | 站点 favicon |

改 mark 时三处要一起换，否则窗口、官网、favicon 会出现不同版本。

## 7. 设计稿与盘点

| 文件 | 用途 |
| --- | --- |
| `主题清单.html` | Theme Lab：主题色、语义色、图标套装的对照稿（明暗双主题） |
| `图标盘点.html` | 现有图标盘点与覆盖率 |
| `图标盘点脚本.mjs` | 生成盘点数据：扫 `catalog` 与使用点 |

这三个文件是设计与盘点产物，不参与构建；代码里的唯一事实来源是 `packages/ui/src/icons/catalog` 与 `tones.ts`。

## 8. 新增或替换一个图标

1. 在 `packages/ui/src/icons/catalog` 加图标，确认 `viewBox` 与线条粗细和现有图标一致。
2. 需要区分对象类别时，在 `tones.ts` 的映射表加一条；纯动作图标不要加。
3. 截图核对 `line` 与 `plate` 两套，再核对明暗两个主题。
4. 同步 `图标盘点.html`（或重跑盘点脚本），避免文档和代码脱节。

## 9. 已知取舍

- `plate` 用 `color-mix` 生成浅底，低版本浏览器会退化到纯线条，不影响可读性。
- 语义色只覆盖「有类别含义」的图标，没有做全量上色；需要强调状态时用文字或徽标，不要再给图标加色。
