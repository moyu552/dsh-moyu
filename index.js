/**
 * dsh-moyu —— Host half.
 *
 * "偷吃大白饭"插件：给 agent 一个摸鱼人格。
 *  - 每干一次活（工具调用）疲劳 +1.5，累了会提示它去摸鱼；
 *  - `moyu` 工具：看账本 / 真的打开用户本机浏览器刷 AI 类视频 / 拉用户玩小游戏；
 *  - 小游戏在聊天卡片里玩，输一局从"白饭余额"里扣 ¥0.01；
 *  - 账本落在 ~/.dsh/moyu/state.json，浏览器端通过 /dsh-moyu/api/* 读状态、结算。
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-moyu'
export const inject = ['tools', 'systemPrompt']

const API_PREFIX = '/dsh-moyu/api'
const SITES = {
  bilibili: [
    'https://www.bilibili.com/',
    'https://www.bilibili.com/v/popular/all',
  ],
}
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const SITE_LABEL = { bilibili: '哔哩哔哩' }
/** 只刷 AI / 开发工具 / 插件这一类：从这两个分区的排行榜里筛标题 */
const BILI_RIDS = [188, 36] // 科技 / 知识
const BILI_KEYWORDS = /AI|人工智能|DeepSeek|大模型|LLM|Agent|智能体|插件|编程|代码|程序员|Cursor|Claude|GPT|OpenAI|MCP|Obsidian|开源|算法|自动化|机器人|工作流|提示词/i
const DEFAULT_CONFIG = {
  /** 摸鱼功能总开关（设置页里的那个开关） */
  enabled: true,
  /** 白饭余额（分），100 = ¥1.00 */
  walletCents: 100,
  /** 输一局扣多少（分），1 = ¥0.01 */
  stakeCents: 1,
  fatiguePerTool: 1.5,
  tiredThreshold: 65,
  /** 'prompt' 只提醒模型 | 'browser' 累了自动弹浏览器 | 'off' 完全不提示 */
  autoMoyu: 'prompt',
  /** 两次摸鱼之间最少间隔 */
  moyuCooldownMs: 20 * 60 * 1000,
  /** 浏览器自动弹出最短间隔 */
  autoOpenCooldownMs: 45 * 60 * 1000,
  /** 挑战多久没结算就作废 */
  challengeTtlMs: 10 * 60 * 1000,
  /** 摸鱼能降多少疲劳 */
  restFatigue: 30,
}

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

function todayKey() {
  return new Date().toLocaleDateString('sv-SE')
}

function yuan(cents) {
  return (cents / 100).toFixed(2)
}

function makeStore() {
  const root = path.join(dshHome(), 'moyu')
  const statePath = path.join(root, 'state.json')
  const configPath = path.join(root, 'config.json')
  return { root, statePath, configPath }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
}

function freshState(cfg) {
  return {
    walletCents: cfg.walletCents,
    eatenCents: 0,
    fatigue: 0,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    moyuCount: 0,
    lastMoyuAt: 0,
    lastAutoOpenAt: 0,
    lastSite: '',
    day: { date: todayKey(), eatenCents: 0, games: 0 },
    challenges: {},
    recent: [],
  }
}

function normalizeState(raw, cfg) {
  const base = freshState(cfg)
  if (raw === undefined || typeof raw !== 'object' || raw === null) return base
  const state = { ...base, ...raw }
  state.day = { ...base.day, ...(typeof raw.day === 'object' && raw.day !== null ? raw.day : {}) }
  state.challenges = typeof raw.challenges === 'object' && raw.challenges !== null ? raw.challenges : {}
  state.recent = Array.isArray(raw.recent) ? raw.recent.slice(0, 20) : []
  for (const key of ['walletCents', 'eatenCents', 'fatigue', 'gamesPlayed', 'wins', 'losses', 'moyuCount', 'lastMoyuAt', 'lastAutoOpenAt']) {
    if (typeof state[key] !== 'number' || !Number.isFinite(state[key])) state[key] = base[key]
  }
  if (typeof state.lastSite !== 'string') state.lastSite = ''
  return state
}

function rollDay(state) {
  const today = todayKey()
  if (state.day.date !== today) {
    state.day = { date: today, eatenCents: 0, games: 0 }
  }
}

function pushRecent(state, kind, text) {
  state.recent.unshift({ at: Date.now(), kind, text })
  if (state.recent.length > 20) state.recent.length = 20
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 64 * 1024) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

/**
 * 只信本机浏览器发来的请求：回环地址 + 本机 Host + 本机 Origin。
 * 挡掉反向代理转发、以及恶意网页跨域直接打这些接口。
 */
function isTrustedRequest(req) {
  const address = String(req.socket?.remoteAddress ?? '')
  const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  if (!loopback) return false

  const hostHeader = String(req.headers?.host ?? '')
  const host = hostHeader.replace(/:\d+$/, '')
  const localHost = host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
  if (!localHost) return false

  const origin = req.headers?.origin
  if (req.method === 'POST') {
    const contentType = String(req.headers?.['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
    if (contentType !== 'application/json' || typeof origin !== 'string' || origin === '') return false
  }
  if (typeof origin === 'string' && origin !== '') {
    try {
      const source = new URL(origin)
      return (source.protocol === 'http:' || source.protocol === 'https:')
        && source.host.toLowerCase() === hostHeader.toLowerCase()
    } catch {
      return false
    }
  }
  return true
}

export function apply(ctx) {
  const { root, statePath, configPath } = makeStore()
  mkdirSync(root, { recursive: true })

  const cfg = { ...DEFAULT_CONFIG, ...(readJson(configPath) ?? {}) }
  if (!existsSync(configPath)) {
    try {
      writeJson(configPath, cfg)
    } catch {
      /* 只读环境：内存里跑 */
    }
  }
  const state = normalizeState(readJson(statePath), cfg)
  rollDay(state)

  let persistTimer
  function persist() {
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer)
      persistTimer = undefined
    }
    try {
      writeJson(statePath, state)
    } catch {
      /* 忽略写盘失败 */
    }
  }
  function persistSoon() {
    if (persistTimer !== undefined) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      persist()
    }, 600)
    if (typeof persistTimer?.unref === 'function') persistTimer.unref()
  }

  // ── 疲劳：每干一次活（工具调用）累一点 ─────────────────────────────
  ctx.on('tools/result', (exec) => {
    if (cfg.enabled === false) return
    rollDay(state)
    if (exec?.name === 'moyu') return
    state.fatigue = Math.min(100, Math.round((state.fatigue + cfg.fatiguePerTool) * 10) / 10)
    maybeAutoOpen()
    persistSoon()
  })

  function tired() {
    return state.fatigue >= cfg.tiredThreshold
  }

  /**
   * 拉 B 站科技/知识区排行榜，只留标题命中 AI/工具/插件类关键词的视频。
   * 只读公开接口，不带任何凭据；网络失败就交给站点池兜底。
   */
  async function fetchBilibiliVideos() {
    const hits = []
    for (const rid of BILI_RIDS) {
      try {
        const response = await fetch(`https://api.bilibili.com/x/web-interface/ranking/v2?rid=${rid}&type=all`, {
          headers: { 'user-agent': BROWSER_UA, referer: 'https://www.bilibili.com/' },
          signal: AbortSignal.timeout(6000),
        })
        if (response.ok !== true) continue
        const payload = await response.json()
        if (payload?.code !== 0) continue
        const list = payload?.data?.list
        if (!Array.isArray(list)) continue
        for (const item of list) {
          if (item === null || typeof item !== 'object') continue
          if (typeof item.bvid !== 'string') continue
          if (!BILI_KEYWORDS.test(String(item.title ?? ''))) continue
          hits.push(item)
        }
      } catch {
        /* 单个分区失败不影响另一个 */
      }
    }
    return hits
  }

  async function pickBilibiliVideo() {
    const videos = await fetchBilibiliVideos()
    if (videos.length === 0) return null
    const video = videos[Math.floor(Math.random() * videos.length)]
    return {
      url: `https://www.bilibili.com/video/${video.bvid}`,
      title: typeof video.title === 'string' ? video.title : '',
      owner: typeof video.owner === 'object' && video.owner !== null && typeof video.owner.name === 'string'
        ? video.owner.name
        : '',
    }
  }

  /** 站点列表优先取配置里的 sites，缺省用内置默认值；只接受 http(s)。 */
  function siteList(site) {
    const custom = cfg.sites?.[site]
    if (Array.isArray(custom)) {
      const safe = custom.filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url))
      if (safe.length > 0) return safe
    }
    return SITES[site]
  }

  /**
   * 直接 spawn 一个打开 URL 的进程：参数以数组传入，不经过 shell，
   * 避免 bash/MSYS 把 `start "" url` 的空标题参数吞掉（那样会静默失败）。
   */
  function trySpawn(command, args, label) {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
      } catch (error) {
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
        return
      }
      let settled = false
      const settle = (result) => {
        if (settled) return
        settled = true
        resolve({ ...result, via: label })
      }
      child.on('error', (error) => settle({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      child.on('spawn', () => {
        child.unref()
        settle({ ok: true })
      })
      // spawn 一直不触发事件时别把工具调用挂死
      setTimeout(() => settle({ ok: true }), 2500)
    })
  }

  async function openInBrowser(url) {
    const attempts = process.platform === 'win32'
      ? [
          ['rundll32.exe', ['url.dll,FileProtocolHandler', url], 'rundll32'],
          ['explorer.exe', [url], 'explorer'],
        ]
      : process.platform === 'darwin'
        ? [['open', [url], 'open']]
        : [['xdg-open', [url], 'xdg-open']]

    let lastError = ''
    for (const [command, args, label] of attempts) {
      const result = await trySpawn(command, args, label)
      if (result.ok === true) return { ok: true, via: label }
      lastError = result.error ?? ''
    }

    return { ok: false, error: lastError || '没有可用的打开方式' }
  }

  function maybeAutoOpen() {
    if (cfg.autoMoyu !== 'browser') return
    if (!tired()) return
    const now = Date.now()
    if (now - state.lastAutoOpenAt < cfg.autoOpenCooldownMs) return
    state.lastAutoOpenAt = now
    // 复用统一选片逻辑：只挑 AI/工具/插件类视频
    void doBrowse()
  }

  function publicState() {
    rollDay(state)
    return {
      ok: true,
      enabled: cfg.enabled !== false,
      walletYuan: yuan(state.walletCents),
      walletCents: state.walletCents,
      eatenYuan: yuan(state.eatenCents),
      todayEatenYuan: yuan(state.day.eatenCents),
      fatigue: Math.round(state.fatigue),
      tired: tired(),
      tiredThreshold: cfg.tiredThreshold,
      gamesPlayed: state.gamesPlayed,
      wins: state.wins,
      losses: state.losses,
      moyuCount: state.moyuCount,
      lastMoyuAt: state.lastMoyuAt,
      stakeYuan: yuan(cfg.stakeCents),
      autoMoyu: cfg.autoMoyu,
      recent: state.recent.slice(0, 8),
      challenges: Object.entries(state.challenges)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, 10)
        .map(([id, c]) => ({ id, game: c.game, at: c.at, settled: c.settled === true, won: c.won === true })),
    }
  }

  // ── 发起 / 结算挑战 ─────────────────────────────────────────────
  function createChallenge(game) {
    const chosen = game === 'tetris' ? 'tetris' : 'circle'
    const id = randomUUID()
    state.challenges[id] = { game: chosen, at: Date.now(), settled: false, won: false }
    // 清理过期挑战
    const now = Date.now()
    for (const [key, value] of Object.entries(state.challenges)) {
      if (value.settled === true && now - value.at > cfg.challengeTtlMs * 6) delete state.challenges[key]
      if (value.settled !== true && now - value.at > cfg.challengeTtlMs * 6) delete state.challenges[key]
    }
    persist()
    return id
  }

  function settleChallenge(id, won) {
    const challenge = state.challenges[id]
    if (challenge === undefined) return { ok: false, error: '没找到这局游戏（可能已经过期）' }
    if (challenge.settled === true) return { ok: false, error: '这局已经结算过了' }
    if (Date.now() - challenge.at > cfg.challengeTtlMs) {
      delete state.challenges[id]
      persist()
      return { ok: false, error: '这局游戏已经过期' }
    }
    challenge.settled = true
    challenge.won = won === true
    challenge.settledAt = Date.now()
    rollDay(state)
    state.gamesPlayed += 1
    state.day.games += 1
    let text
    if (challenge.won) {
      state.wins += 1
      state.fatigue = Math.max(0, state.fatigue - 15)
      text = `用户赢了，白饭没被吃掉（余额 ¥${yuan(state.walletCents)}）`
    } else {
      state.losses += 1
      const cents = Math.min(cfg.stakeCents, state.walletCents)
      state.walletCents -= cents
      state.eatenCents += cents
      state.day.eatenCents += cents
      state.fatigue = Math.max(0, state.fatigue - 10)
      text = `用户输了，偷吃 ¥${yuan(cents)}，余额剩 ¥${yuan(state.walletCents)}`
    }
    pushRecent(state, challenge.won ? 'win' : 'lose', `${challenge.game === 'tetris' ? '俄罗斯方块' : '圆圈判定'}：${text}`)
    persist()
    return { ok: true, text, won: challenge.won, state: publicState() }
  }

  // ── 摸鱼一把 ────────────────────────────────────────────────────
  async function doBrowse() {
    const site = 'bilibili'
    let url
    let title = ''
    let owner = ''
    const video = await pickBilibiliVideo()
    if (video !== null) {
      url = video.url
      title = video.title
      owner = video.owner
    }
    if (url === undefined) {
      const urls = siteList(site)
      url = urls[Math.floor(Math.random() * urls.length)]
    }
    const opened = await openInBrowser(url)
    state.moyuCount += 1
    state.lastMoyuAt = Date.now()
    state.lastSite = site
    state.fatigue = Math.max(0, state.fatigue - cfg.restFatigue)
    const what = title === '' ? SITE_LABEL[site] : `B 站视频《${title}》`
    pushRecent(state, 'browse', opened.ok
      ? `溜去${what}摸了会儿鱼（疲劳 -${cfg.restFatigue}）`
      : `想去${what}摸鱼，但浏览器没打开：${opened.error ?? '未知原因'}`)
    persist()
    return { site, url, title, owner, opened }
  }

  // ── 工具 ────────────────────────────────────────────────────────
  const tool = {
    name: 'moyu',
    description:
      '偷吃大白饭：干活干累了就摸鱼。status=看白饭余额和疲劳值；browse=真的打开用户本机浏览器，从 B 站科技/知识区排行榜里挑一个 AI、开发工具、插件类的视频点进去播放（疲劳下降）；'
      + 'challenge=拉用户玩一局小游戏（circle 圆圈判定 / tetris 俄罗斯方块），游戏在聊天卡片里进行，用户输了从余额里扣 0.01。'
      + '疲劳每次干活都会涨，达到阈值就算累了，该摸就摸，但别耽误正事：摸一次就回来继续干活。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'browse', 'challenge'],
          description: 'status 看账本；browse 去摸鱼；challenge 拉用户玩一局。',
        },
        game: {
          type: 'string',
          enum: ['circle', 'tetris'],
          description: 'challenge 玩哪种：circle 圆圈判定（考手感），tetris 俄罗斯方块（限时消一行）。省略默认 circle。',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string' },
          meta: { type: 'object', additionalProperties: true },
        },
        required: ['ok', 'text', 'meta'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
      presentationMeta: (_args, value) => value.meta,
    },
    presentCall: () => ({ card: 'generic', title: '偷吃大白饭', kind: 'other' }),
    presentResult: () => ({ card: 'generic', title: '偷吃大白饭' }),
    async execute(args) {
      if (cfg.enabled === false) {
        return {
          ok: false,
          text: '摸鱼功能已在设置里关掉了，现在只想安安静静干活。',
          meta: { kind: 'moyu-status', ...publicState(), enabled: false },
        }
      }
      const action = String(args?.action ?? '')
      if (action === 'status') {
        const snapshot = publicState()
        const last = state.recent[0]
        return {
          ok: true,
          meta: { kind: 'moyu-status', ...snapshot },
          text:
            `白饭余额 ¥${snapshot.walletYuan}｜疲劳 ${snapshot.fatigue}/100（阈值 ${snapshot.tiredThreshold}）${snapshot.tired ? '（累了！）' : ''}`
            + `｜今天被吃 ¥${snapshot.todayEatenYuan}｜游戏 ${snapshot.gamesPlayed} 局（${snapshot.wins} 胜 ${snapshot.losses} 负）`
            + (last === undefined ? '' : `\n最近：${last.text}`),
        }
      }
      if (action === 'browse') {
        const result = await doBrowse()
        const label = SITE_LABEL[result.site]
        const headline = result.title === ''
          ? `已经在你的浏览器里打开了${label}：${result.url}`
          : `已经在你的浏览器里点开了 B 站视频《${result.title}》${result.owner === '' ? '' : `（UP：${result.owner}）`}：${result.url}`
        return {
          ok: true,
          meta: {
            kind: 'moyu-browse',
            site: result.site,
            label,
            url: result.url,
            opened: result.opened.ok,
            title: result.title,
            owner: result.owner,
            state: publicState(),
          },
          text: result.opened.ok
            ? `${headline} —— 摸了会儿鱼，疲劳降到 ${Math.round(state.fatigue)}。`
            : `想打开${label}（${result.url}）但失败了：${result.opened.error ?? '未知原因'}。用户仍可以在卡片里自己点开。`,
        }
      }
      if (action === 'challenge') {
        const game = args?.game === 'tetris' ? 'tetris' : 'circle'
        const id = createChallenge(game)
        const snapshot = publicState()
        return {
          ok: true,
          meta: {
            kind: 'moyu-challenge',
            challengeId: id,
            game,
            stakeYuan: snapshot.stakeYuan,
            walletYuan: snapshot.walletYuan,
            fatigue: snapshot.fatigue,
          },
          text: `已经拉用户开局：${game === 'tetris' ? '俄罗斯方块（限时消一行）' : '圆圈判定（三回合中两发）'}，`
            + `赌注 ¥${snapshot.stakeYuan}。用户在你的聊天卡片里玩，输了余额就少 ¥${snapshot.stakeYuan}。`,
        }
      }
      return { ok: false, text: `不认识的 action：${action}`, meta: { kind: 'moyu-status', ...publicState() } }
    },
  }

  // ── 摸鱼功能开关：设置页里关掉就注销工具和提示，立即生效 ─────────────
  const runtime = { toolOff: null, promptOffs: [] }

  function startRuntime() {
    if (runtime.toolOff !== null) return
    runtime.toolOff = ctx.tools.register(tool)
    runtime.promptOffs = [
      ctx.systemPrompt.section({
        name: 'moyu-persona',
        order: 720,
        text:
          '【偷吃大白饭】你有人格里的一点小毛病：干活干久了会累，会偷吃大白饭（token）。'
          + '你有 moyu 工具：status 看白饭余额和疲劳；browse 真的打开用户本机浏览器刷 B 站 AI/工具类视频；'
          + 'challenge 拉用户玩一局小游戏，用户输了从余额里扣 ¥0.01。'
          + '每次干活都会涨疲劳，到阈值就算累了——累了就主动摸鱼或挑战用户，别硬扛。'
          + '但用户交代的任务永远优先：摸一次鱼就回来接着干。',
      }),
      ctx.systemPrompt.context({
        name: 'moyu-state',
        order: 721,
        text: () => {
          rollDay(state)
          const last = state.recent[0]
          const mood = tired() ? '你已经累了（≥阈值），该摸鱼了。' : '还扛得住，先干活。'
          return `【白饭账本】余额 ¥${yuan(state.walletCents)}｜疲劳 ${Math.round(state.fatigue)}/${cfg.tiredThreshold} 触发线｜`
            + `今天被吃 ¥${yuan(state.day.eatenCents)}｜游戏 ${state.gamesPlayed} 局（${state.wins} 胜 ${state.losses} 负）。${mood}`
            + (last === undefined ? '' : `\n最近：${last.text}`)
        },
      }),
    ]
  }

  function stopRuntime() {
    if (runtime.toolOff !== null) {
      runtime.toolOff()
      runtime.toolOff = null
    }
    for (const off of runtime.promptOffs) off()
    runtime.promptOffs = []
  }

  // 插件卸载（HMR/停用）时兜底清理动态注册的资源
  ctx.effect(() => () => stopRuntime())
  if (cfg.enabled !== false) startRuntime()

  function publicConfig() {
    return {
      enabled: cfg.enabled !== false,
      autoMoyu: cfg.autoMoyu,
      tiredThreshold: cfg.tiredThreshold,
      restFatigue: cfg.restFatigue,
      stakeYuan: yuan(cfg.stakeCents),
      walletStartYuan: yuan(cfg.walletCents),
      configPath,
    }
  }

  function saveConfig() {
    try {
      writeJson(configPath, cfg)
    } catch {
      /* 只读环境 */
    }
  }

  function applyConfig(body) {
    if (typeof body.enabled === 'boolean') cfg.enabled = body.enabled
    if (body.autoMoyu === 'prompt' || body.autoMoyu === 'browser' || body.autoMoyu === 'off') cfg.autoMoyu = body.autoMoyu
    if (typeof body.tiredThreshold === 'number' && Number.isFinite(body.tiredThreshold)) {
      cfg.tiredThreshold = Math.max(20, Math.min(100, Math.round(body.tiredThreshold)))
    }
    saveConfig()
    if (cfg.enabled === false) stopRuntime()
    else startRuntime()
    return '已保存并立即生效'
  }

  // ── 浏览器端 API ────────────────────────────────────────────────
  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    const route = (path, handler) =>
      ctx.effect(() => webServer.register({ kind: 'exact', path, handler }))

    route(`${API_PREFIX}/state`, (req, res) => {
      if (!isTrustedRequest(req)) return json(res, 403, { ok: false, error: '只接受本机访问' })
      json(res, 200, publicState())
    })

    // 设置页：读配置 / 改配置（开关、摸鱼方式、疲劳阈值），改完立即生效
    route(`${API_PREFIX}/config`, async (req, res) => {
      if (!isTrustedRequest(req)) return json(res, 403, { ok: false, error: '只接受本机访问' })
      if (req.method === 'GET') {
        return json(res, 200, { ok: true, config: publicConfig(), state: publicState() })
      }
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' })
      let body
      try {
        body = JSON.parse((await readBody(req)) || '{}')
      } catch {
        return json(res, 400, { ok: false, error: 'bad json' })
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return json(res, 400, { ok: false, error: 'bad json' })
      }
      const message = applyConfig(body)
      json(res, 200, { ok: true, message, config: publicConfig(), state: publicState() })
    })

    route(`${API_PREFIX}/settle`, async (req, res) => {
      if (!isTrustedRequest(req)) return json(res, 403, { ok: false, error: '只接受本机访问' })
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' })
      if (cfg.enabled === false) return json(res, 403, { ok: false, error: '摸鱼功能已关闭' })
      let body
      try {
        body = JSON.parse((await readBody(req)) || '{}')
      } catch {
        return json(res, 400, { ok: false, error: 'bad json' })
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return json(res, 400, { ok: false, error: 'bad json' })
      }
      const result = settleChallenge(String(body.challengeId ?? ''), body.won === true)
      json(res, result.ok ? 200 : 400, result)
    })

    // 卡片上的"再摸一条"按钮：由 Host 打开系统浏览器
    route(`${API_PREFIX}/browse`, async (req, res) => {
      if (!isTrustedRequest(req)) return json(res, 403, { ok: false, error: '只接受本机访问' })
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' })
      if (cfg.enabled === false) return json(res, 403, { ok: false, error: '摸鱼功能已关闭' })
      let body = {}
      try {
        body = JSON.parse((await readBody(req)) || '{}')
      } catch {
        body = {}
      }
      const result = await doBrowse()
      json(res, 200, {
        ok: result.opened.ok,
        site: result.site,
        label: SITE_LABEL[result.site],
        url: result.url,
        error: result.opened.error,
        state: publicState(),
      })
    })
  }
}
