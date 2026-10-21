# dsh-moyu · 偷吃大白饭

给 DSH 里的 DeepSeek 装上一点小毛病：干活干久了会累，会偷吃大白饭（token），
会溜去 B 站刷 AI/开发工具类的视频，累了还会拉你在聊天卡片里玩一局小游戏——输了就从你的余额里扣 ¥0.01。

## 装了什么

**Host（`index.js`）**
- `moyu` 工具：`status` 看账本 / `browse` 真的用系统浏览器摸鱼 / `challenge` 发起一局小游戏。
  - **B 站**：从科技区（188）和知识区（36）排行榜里筛出标题命中 AI / 大模型 / 插件 / 编程 / 开源等关键词的视频，随机挑一个直接打开**播放页**（浏览器自动开始播），结果里带标题和 UP 主；筛不到就回退到站点池。
- 疲劳值：每次工具调用 +1.5，摸鱼 −30，赢了 −15、输了 −10。≥65 判为「累了」。
- 系统提示注入：`moyu-persona`（人格）+ `moyu-state`（每步的余额/疲劳/最近记录）。
- 账本：`$DSH_HOME/moyu/state.json`，配置 `$DSH_HOME/moyu/config.json`（首次自动生成）。
- HTTP API（本机回环）：
  - `GET  /dsh-moyu/api/state`
  - `POST /dsh-moyu/api/settle` `{ challengeId, won }`
  - `POST /dsh-moyu/api/browse` `{ target? }`

**Client（`client.js`）**
- `tool.call.toolview` key=`moyu`：摸鱼卡、白饭账本卡、挑战卡（卡片内直接玩）。
- 两个小游戏：
  - **圆圈判定**：收缩的蓝圈压住金色虚线圆时点击，三回合中两发。
  - **俄罗斯方块 · 小关卡**：30 秒内消掉一行算赢，方向键 / WASD 操作。
- `shell.overlay` id=`moyu-hud`：右下角常驻白饭徽章，可展开看账本、让它去摸鱼。

## 设置里有个「摸鱼」页

DSH 设置 → **摸鱼**（`settings.section`），三块：

1. **摸鱼功能**：总开关。关掉**立即生效**——`moyu` 工具从模型手里收回、摸鱼人格提示不再注入、疲劳停止累积、右下角白饭徽章隐藏。账本数据保留。
2. **累了怎么办**：只提醒模型 / 自动弹浏览器 / 完全安静（对应 `autoMoyu`）。
3. **疲劳阈值**：20–100 可调（对应 `tiredThreshold`），越低越容易喊累。

改完直接写回 `config.json` 并重启插件运行时，不需要重启 DSH。

## 配置（`$DSH_HOME/moyu/config.json`）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 摸鱼功能总开关（设置页里的开关） |
| `walletCents` | 100 | 初始白饭余额（分） |
| `stakeCents` | 1 | 输一局扣多少（分）= ¥0.01 |
| `fatiguePerTool` | 1.5 | 每次工具调用增加的疲劳 |
| `tiredThreshold` | 65 | 到这个值算「累了」 |
| `autoMoyu` | `prompt` | `prompt` 只提醒模型；`browser` 累了自动弹浏览器；`off` 关闭提示 |
| `restFatigue` | 30 | 摸鱼一次降多少疲劳 |
| `sites` | 内置 B 站兜底地址 | 可选：`{ "bilibili": ["https://..."] }`，只接受 http(s)；筛不到 AI 类视频时用它兜底 |

`enabled` / `autoMoyu` / `tiredThreshold` 在设置页里改，**立即生效**；其余字段改 `config.json` 后重启 DSH。

## 安装

```bash
# link 到本地源码目录（把 <plugin-dir> 换成你 clone 下来的路径）
dsh plugin add "link:<plugin-dir>"
```

或让 DSH 自己装：`plugin_manager install_bundle`，target 传插件目录的绝对路径。

## 安全与隐私

- **插件代码里没有任何 API key、cookie、token 或账号凭据**，也不读取环境变量里的密钥；摸鱼只打开公开网页。
- 运行时数据（白饭余额、疲劳、游戏记录）只写在本机 `$DSH_HOME/moyu/`，不上传任何地方。
- `config.json` / `state.json` 已列进 `.gitignore`；发布前仍要检查暂存文件，避免误加本地配置或凭据。
- 想换摸鱼网站，改 `config.json` 的 `sites`，不必动代码。

## License

MIT，见 [LICENSE](./LICENSE)。
