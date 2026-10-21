/**
 * dsh-moyu —— Client half (Web UI).
 *
 *  - tool.call.toolview(key='moyu')：摸鱼/账本/小游戏卡片
 *  - shell.overlay(id='moyu-hud')：右下角白饭余额小徽章
 * 游戏全部在浏览器本地判定，结果通过 /dsh-moyu/api/settle 交给 Host 记账。
 */
window.__ModuleLoader__.load({
  id: 'dsh-moyu',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    // ── 主题与配色 ────────────────────────────────────────────────
    const TOK = {
      bg: 'var(--dsw-alias-bg-layer-1)',
      bg2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      text: 'var(--dsw-alias-label-primary)',
      dim: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      bad: 'var(--dsw-alias-state-error-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
    }
    const RICE = '#c9a227'
    const RICE_SOFT = 'rgba(201,162,39,0.16)'

    const sx = {
      card: {
        border: `1px solid ${TOK.border}`,
        background: TOK.bg,
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        color: TOK.text,
        fontSize: 13,
        lineHeight: 1.55,
        maxWidth: 560,
      },
      headRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      title: { fontWeight: 600, fontSize: 13 },
      dim: { color: TOK.dim, fontSize: 12 },
      big: { fontSize: 26, fontWeight: 700, letterSpacing: '0.5px', color: RICE, fontVariantNumeric: 'tabular-nums' },
      row: { display: 'flex', gap: 10, flexWrap: 'wrap' },
      cell: {
        flex: '1 1 110px', minWidth: 104, padding: '8px 10px', borderRadius: 10,
        background: TOK.bg2, border: `1px solid ${TOK.border}`,
      },
      btn: {
        cursor: 'pointer', border: `1px solid ${TOK.border2}`, background: TOK.bg2,
        color: TOK.text, borderRadius: 8, padding: '6px 12px', fontSize: 12,
        fontFamily: 'inherit', transition: 'filter .15s',
      },
      btnPrimary: {
        cursor: 'pointer', border: `1px solid ${RICE}`, background: RICE_SOFT,
        color: TOK.text, borderRadius: 8, padding: '7px 14px', fontSize: 12,
        fontFamily: 'inherit', fontWeight: 600,
      },
      bar: {
        height: 6, borderRadius: 3, background: TOK.bg2, overflow: 'hidden',
        border: `1px solid ${TOK.border}`,
      },
      barFill: { height: '100%', borderRadius: 3, background: RICE, transition: 'width .4s' },
      tag: {
        display: 'inline-block', padding: '1px 7px', borderRadius: 99, fontSize: 11,
        background: RICE_SOFT, color: RICE, border: `1px solid rgba(201,162,39,0.4)`,
      },
      mono: { fontVariantNumeric: 'tabular-nums' },
    }

    // ── 网络 ──────────────────────────────────────────────────────
    async function apiGet(path) {
      const r = await fetch(`/dsh-moyu/api${path}`, { headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }
    async function apiPost(path, body) {
      const r = await fetch(`/dsh-moyu/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok && !j.error) j.error = `HTTP ${r.status}`
      return j
    }

    function useLiveState(intervalMs) {
      const [live, setLive] = useState(null)
      useEffect(() => {
        let alive = true
        const load = () => {
          apiGet('/state').then((s) => { if (alive) setLive(s) }).catch(() => undefined)
        }
        load()
        const timer = setInterval(load, intervalMs ?? 5000)
        return () => { alive = false; clearInterval(timer) }
      }, [intervalMs])
      return live
    }

    // ── 小工具 ────────────────────────────────────────────────────
    function metaOf(block) {
      if (block === undefined || block === null) return null
      if (!('kind' in block)) return null
      if (block.isError === true) return null
      const meta = block.meta
      if (meta === undefined || meta === null || typeof meta !== 'object') return null
      if (typeof meta.kind !== 'string' || meta.kind.indexOf('moyu-') !== 0) return null
      return meta
    }

    function Pending() {
      return h('div', { style: { ...sx.headRow, color: TOK.dim, fontSize: 12 } },
        h('span', null, '🍚'),
        h('span', null, '偷吃大白饭中…'))
    }

    // ── 摸鱼卡片（browse）─────────────────────────────────────────
    function BrowseBlock({ meta }) {
      const live = useLiveState(6000)
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')
      const more = useCallback(async () => {
        setBusy(true)
        setNote('')
        try {
          const r = await apiPost('/browse', {})
          setNote(r.ok === true ? `又溜去${r.label ?? ''}看了一眼` : (r.error || '浏览器没打开'))
        } catch (error) {
          setNote(String(error))
        } finally {
          setBusy(false)
        }
      }, [meta.site])
      const wallet = live?.walletYuan ?? meta?.state?.walletYuan ?? '--'
      const fatigue = live?.fatigue ?? meta?.state?.fatigue ?? 0
      return h('div', { style: sx.card },
        h('div', { style: sx.headRow },
          h('span', { style: { fontSize: 18 } }, '🐟'),
          h('span', { style: sx.title },
            meta.title !== undefined && meta.title !== ''
              ? `正在看：${String(meta.title).slice(0, 36)}`
              : `溜去${meta.label ?? '网上'}摸鱼`),
          h('span', { style: sx.tag }, meta.opened === true ? '浏览器已打开' : '浏览器没打开'),
        ),
        meta.owner !== undefined && meta.owner !== ''
          ? h('div', { style: sx.dim }, `UP 主：${meta.owner}`)
          : null,
        h('div', { style: sx.dim }, meta.opened === true
          ? 'DeepSeek 悄悄打开了你的本机浏览器，正在摸鱼。'
          : '没能自动打开浏览器，点下面的按钮自己开一个。'),
        h('div', { style: sx.row },
          h('div', { style: sx.cell },
            h('div', { style: sx.dim }, '白饭余额'),
            h('div', { style: { fontSize: 18, fontWeight: 700, color: RICE, ...sx.mono } }, `¥${wallet}`)),
          h('div', { style: sx.cell },
            h('div', { style: sx.dim }, '疲劳值'),
            h('div', { style: { fontSize: 18, fontWeight: 700, ...sx.mono } }, `${fatigue}/100`)),
        ),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('button', {
            type: 'button', style: { ...sx.btnPrimary, opacity: busy ? 0.6 : 1 },
            onClick: more, disabled: busy,
          }, busy ? '正在摸…' : '再摸一条'),
          h('a', {
            href: meta.url, target: '_blank', rel: 'noreferrer',
            style: { ...sx.btn, textDecoration: 'none', display: 'inline-block' },
          }, '我自己打开'),
        ),
        note === '' ? null : h('div', { style: sx.dim }, note),
      )
    }

    // ── 账本卡片（status）─────────────────────────────────────────
    function StatusBlock({ meta }) {
      const live = useLiveState(5000)
      const s = live ?? meta
      const fatigue = Math.max(0, Math.min(100, Number(s?.fatigue) || 0))
      const tired = s?.tired === true
      return h('div', { style: sx.card },
        h('div', { style: sx.headRow },
          h('span', { style: { fontSize: 18 } }, '🍚'),
          h('span', { style: sx.title }, '白饭账本'),
          h('span', { style: sx.tag }, tired ? '累了' : '还扛得住'),
        ),
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          h('div', { style: sx.big }, `¥${s?.walletYuan ?? '--'}`),
          h('div', { style: sx.dim }, `今天被吃掉 ¥${s?.todayEatenYuan ?? '0.00'}`)),
        h('div', null,
          h('div', { style: { ...sx.dim, marginBottom: 4, display: 'flex', justifyContent: 'space-between' } },
            h('span', null, '疲劳'),
            h('span', { style: sx.mono }, `${Math.round(fatigue)}/100`)),
          h('div', { style: sx.bar }, h('div', { style: { ...sx.barFill, width: `${fatigue}%` } })),
        ),
        h('div', { style: sx.row },
          h('div', { style: sx.cell },
            h('div', { style: sx.dim }, '小游戏'),
            h('div', { style: { fontSize: 16, fontWeight: 600, ...sx.mono } }, `${s?.gamesPlayed ?? 0} 局`),
            h('div', { style: sx.dim }, `${s?.wins ?? 0} 胜 · ${s?.losses ?? 0} 负`)),
          h('div', { style: sx.cell },
            h('div', { style: sx.dim }, '摸鱼次数'),
            h('div', { style: { fontSize: 16, fontWeight: 600, ...sx.mono } }, `${s?.moyuCount ?? 0} 次`),
            h('div', { style: sx.dim }, `累计被吃 ¥${s?.eatenYuan ?? '0.00'}`)),
        ),
        Array.isArray(s?.recent) && s.recent.length > 0
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              h('div', { style: sx.dim }, '最近'),
              ...s.recent.slice(0, 4).map((item, index) =>
                h('div', { key: `${item.at}-${index}`, style: { ...sx.dim, color: TOK.text } },
                  h('span', { style: { color: TOK.dim, marginRight: 6 } }, '·'),
                  item.text)))
          : null,
      )
    }

    // ── 游戏：圆圈判定 ────────────────────────────────────────────
    const CIRCLE_SIZE = 240
    const TARGET_R = 46
    const TOLERANCE = 8

    function CircleGame({ onDone }) {
      const [round, setRound] = useState(0)
      const [hits, setHits] = useState(0)
      const [radius, setRadius] = useState(190)
      const [flash, setFlash] = useState('')
      const radiusRef = useRef(190)
      const runningRef = useRef(true)
      const rafRef = useRef(0)
      const lockRef = useRef(false)

      useEffect(() => {
        // 每回合一进来都要重新开工：上一回合的 cleanup 把 runningRef 关掉了。
        runningRef.current = true
        let last = 0
        const speed = (dt) => dt * (0.055 + round * 0.01)
        const tick = (ts) => {
          if (!runningRef.current) return
          if (last === 0) last = ts
          const dt = Math.min(48, ts - last)
          last = ts
          if (!lockRef.current) {
            radiusRef.current = radiusRef.current - speed(dt)
            if (radiusRef.current <= 8) {
              // 缩没了：这回合算失手
              lockRef.current = true
              setFlash('错过了')
              setRadius(8)
              window.setTimeout(() => nextRound(false), 620)
              return
            }
            setRadius(radiusRef.current)
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
        return () => { runningRef.current = false; cancelAnimationFrame(rafRef.current) }
      }, [round])

      const nextRound = (hit) => {
        const nextHits = hits + (hit ? 1 : 0)
        const nextRoundNo = round + 1
        setHits(nextHits)
        if (nextRoundNo >= 3) {
          runningRef.current = false
          window.setTimeout(() => onDone(nextHits >= 2), 420)
          return
        }
        lockRef.current = false
        radiusRef.current = 190
        setRadius(190)
        setFlash('')
        setRound(nextRoundNo)
      }

      const shoot = () => {
        if (lockRef.current || !runningRef.current) return
        const distance = Math.abs(radiusRef.current - TARGET_R)
        const hit = distance <= TOLERANCE
        lockRef.current = true
        setFlash(hit ? `命中！偏差 ${Math.round(distance)}px` : `差一点（${Math.round(distance)}px）`)
        window.setTimeout(() => nextRound(hit), 560)
      }

      const pct = (radius / CIRCLE_SIZE) * 50
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: { ...sx.headRow, justifyContent: 'space-between' } },
          h('span', { style: sx.dim }, `第 ${Math.min(round + 1, 3)}/3 回合`),
          h('span', { style: { ...sx.dim, color: hits > 0 ? TOK.ok : TOK.dim } }, `命中 ${hits}`)),
        h('div', {
          onClick: shoot,
          style: {
            position: 'relative', width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: 16,
            background: TOK.bg2, border: `1px solid ${TOK.border}`, overflow: 'hidden',
            cursor: 'crosshair', userSelect: 'none', margin: '0 auto',
            touchAction: 'manipulation',
          },
        },
          h('div', {
            style: {
              position: 'absolute', left: '50%', top: '50%',
              width: TARGET_R * 2, height: TARGET_R * 2, marginLeft: -TARGET_R, marginTop: -TARGET_R,
              borderRadius: '50%', border: `2px dashed ${RICE}`, opacity: 0.85,
            },
          }),
          h('div', {
            style: {
              position: 'absolute', left: '50%', top: '50%',
              width: radius * 2, height: radius * 2, marginLeft: -radius, marginTop: -radius,
              borderRadius: '50%', border: `2px solid ${TOK.brand}`,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.15) inset',
            },
          }),
          h('div', {
            style: {
              position: 'absolute', left: '50%', top: '50%', width: 4, height: 4,
              marginLeft: -2, marginTop: -2, borderRadius: '50%', background: RICE, opacity: 0.9,
            },
          }),
          flash === ''
            ? null
            : h('div', {
                style: {
                  position: 'absolute', left: 0, right: 0, bottom: 10, textAlign: 'center',
                  fontSize: 12, color: flash.indexOf('命中') === 0 ? TOK.ok : TOK.bad,
                },
              }, flash),
        ),
        h('div', { style: { ...sx.dim, textAlign: 'center' } },
          '点击方格 —— 让收缩的蓝圈刚好压住金色虚线圈。三回合命中两发算赢。'),
        h('a', { href: '#', style: { ...sx.btnPrimary, textAlign: 'center', textDecoration: 'none' },
          onClick: (event) => { event.preventDefault(); shoot() } }, '开火'),
      )
    }

    // ── 游戏：俄罗斯方块小关卡 ────────────────────────────────────
    const COLS = 10
    const ROWS = 13
    const CELL_PX = 22
    const TETRIS_SHAPES = [
      [[1, 1, 1, 1]],
      [[1, 1], [1, 1]],
      [[0, 1, 0], [1, 1, 1]],
      [[1, 0, 0], [1, 1, 1]],
      [[0, 0, 1], [1, 1, 1]],
      [[1, 1, 0], [0, 1, 1]],
      [[0, 1, 1], [1, 1, 0]],
    ]

    function emptyBoard() {
      const board = []
      for (let r = 0; r < ROWS; r++) {
        const row = []
        for (let c = 0; c < COLS; c++) row.push(0)
        board.push(row)
      }
      return board
    }

    function collides(board, shape, x, y) {
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (shape[r][c] === 0) continue
          const bx = x + c
          const by = y + r
          if (bx < 0 || bx >= COLS || by >= ROWS) return true
          if (by >= 0 && board[by][bx] !== 0) return true
        }
      }
      return false
    }

    function rotate(shape) {
      const rows = shape.length
      const cols = shape[0].length
      const out = []
      for (let c = 0; c < cols; c++) {
        const row = []
        for (let r = rows - 1; r >= 0; r--) row.push(shape[r][c])
        out.push(row)
      }
      return out
    }

    function initialTetris() {
      const shape = TETRIS_SHAPES[Math.floor(Math.random() * TETRIS_SHAPES.length)]
      return {
        board: emptyBoard(),
        piece: { shape, x: Math.floor((COLS - shape[0].length) / 2), y: 0 },
        over: false,
        lines: 0,
      }
    }

    function TetrisGame({ onDone }) {
      const bootRef = useRef(null)
      if (bootRef.current === null) bootRef.current = initialTetris()
      const [board, setBoard] = useState(bootRef.current.board)
      const [piece, setPiece] = useState(bootRef.current.piece)
      const [seconds, setSeconds] = useState(30)
      const [lines, setLines] = useState(0)
      const [over, setOver] = useState(false)
      const stateRef = useRef(bootRef.current)

      const finish = useCallback((won) => {
        if (stateRef.current.over) return
        stateRef.current.over = true
        setOver(true)
        window.setTimeout(() => onDone(won), 320)
      }, [onDone])

      const spawn = useCallback(() => {
        const shape = TETRIS_SHAPES[Math.floor(Math.random() * TETRIS_SHAPES.length)]
        const next = { shape, x: Math.floor((COLS - shape[0].length) / 2), y: -1 }
        if (collides(stateRef.current.board, next.shape, next.x, 0)) {
          finish(false)
          return
        }
        next.y = 0
        stateRef.current.piece = next
        setPiece(next)
        if (collides(stateRef.current.board, next.shape, next.x, 0)) finish(false)
      }, [finish])

      const lockPiece = useCallback(() => {
        const s = stateRef.current
        const shape = s.piece.shape
        const grid = s.board.map((row) => row.slice())
        for (let r = 0; r < shape.length; r++) {
          for (let c = 0; c < shape[r].length; c++) {
            if (shape[r][c] === 0) continue
            const by = s.piece.y + r
            const bx = s.piece.x + c
            if (by < 0) { finish(false); return }
            grid[by][bx] = 1
          }
        }
        let cleared = 0
        for (let r = 0; r < ROWS; r++) {
          if (grid[r].every((cell) => cell !== 0)) {
            grid.splice(r, 1)
            grid.unshift(new Array(COLS).fill(0))
            cleared += 1
          }
        }
        s.board = grid
        setBoard(grid)
        if (cleared > 0) {
          s.lines += cleared
          setLines(s.lines)
          finish(true)
          return
        }
        spawn()
      }, [finish, spawn])

      const step = useCallback((dxOrRotate) => {
        const s = stateRef.current
        if (s.over) return
        const current = s.piece
        if (dxOrRotate === 'rotate') {
          const shape = rotate(current.shape)
          if (!collides(s.board, shape, current.x, current.y)) {
            s.piece = { ...current, shape }
            setPiece(s.piece)
          }
          return
        }
        const nextX = current.x + dxOrRotate
        if (!collides(s.board, current.shape, nextX, current.y)) {
          s.piece = { ...current, x: nextX }
          setPiece(s.piece)
        }
      }, [])

      const softDrop = useCallback(() => {
        const s = stateRef.current
        if (s.over) return
        if (!collides(s.board, s.piece.shape, s.piece.x, s.piece.y + 1)) {
          s.piece = { ...s.piece, y: s.piece.y + 1 }
          setPiece(s.piece)
        } else {
          lockPiece()
        }
      }, [lockPiece])

      // 倒计时
      useEffect(() => {
        const timer = setInterval(() => {
          if (stateRef.current.over) return
          setSeconds((prev) => {
            if (prev <= 1) {
              finish(false)
              return 0
            }
            return prev - 1
          })
        }, 1000)
        return () => clearInterval(timer)
      }, [finish])

      // 自动下落
      useEffect(() => {
        const timer = setInterval(() => softDrop(), 620)
        return () => clearInterval(timer)
      }, [softDrop])

      // 键盘
      useEffect(() => {
        const onKey = (event) => {
          const key = event.key
          if (key === 'ArrowLeft' || key === 'a' || key === 'A') { event.preventDefault(); step(-1) }
          else if (key === 'ArrowRight' || key === 'd' || key === 'D') { event.preventDefault(); step(1) }
          else if (key === 'ArrowDown' || key === 's' || key === 'S') { event.preventDefault(); softDrop() }
          else if (key === 'ArrowUp' || key === 'w' || key === 'W') { event.preventDefault(); step('rotate') }
          else if (key === ' ') { event.preventDefault(); step('rotate') }
        }
        window.addEventListener('keydown', onKey, { passive: false })
        return () => window.removeEventListener('keydown', onKey)
      }, [step, softDrop])

      const cells = []
      const boardRef = stateRef.current.board
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const filled = boardRef[r]?.[c] === 1
          cells.push(h('div', {
            key: `${r}-${c}`,
            style: {
              width: CELL_PX, height: CELL_PX, borderRadius: 3,
              border: `1px solid ${filled ? 'transparent' : TOK.border}`,
              background: filled ? RICE : TOK.bg2,
              opacity: filled ? 0.92 : 1,
            },
          }))
        }
      }
      const overlay = []
      const shape = piece.shape
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (shape[r][c] === 0) continue
          const by = piece.y + r
          const bx = piece.x + c
          if (by < 0) continue
          overlay.push(h('div', {
            key: `p-${r}-${c}`,
            style: {
              position: 'absolute', width: CELL_PX, height: CELL_PX, borderRadius: 3,
              left: bx * (CELL_PX + 2), top: by * (CELL_PX + 2),
              background: TOK.brand, opacity: 0.9,
            },
          }))
        }
      }

      const padBtn = (label, onClick) => h('button', {
        type: 'button', style: { ...sx.btn, padding: '6px 10px', fontSize: 14, minWidth: 42 }, onClick,
      }, label)

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' } },
        h('div', { style: { ...sx.headRow, justifyContent: 'space-between', width: 240 } },
          h('span', { style: { ...sx.dim, color: seconds <= 10 ? TOK.bad : TOK.dim } }, `⏱ ${seconds}s`),
          h('span', { style: sx.dim }, `消行 ${lines}`)),
        h('div', {
          style: {
            position: 'relative', width: COLS * (CELL_PX + 2), padding: 1, borderRadius: 12,
            background: TOK.bg2, border: `1px solid ${TOK.border}`,
            display: 'grid', gridTemplateColumns: `repeat(${COLS}, ${CELL_PX}px)`, gap: 2,
          },
        }, cells, overlay),
        h('div', { style: { display: 'flex', gap: 6 } },
          padBtn('←', () => step(-1)),
          padBtn('→', () => step(1)),
          padBtn('↓', () => softDrop()),
          padBtn('⟳', () => step('rotate'))),
        h('div', { style: { ...sx.dim, textAlign: 'center' } },
          '30 秒内消掉一行算赢。方向键 / WASD 控制，↑ 旋转。'),
        over ? h('div', { style: { ...sx.dim, color: TOK.warn } }, '结算中…') : null,
      )
    }

    // ── 挑战卡片 ──────────────────────────────────────────────────
    function ChallengeBlock({ meta }) {
      const [phase, setPhase] = useState('ready')
      const [outcome, setOutcome] = useState(null)
      const [wallet, setWallet] = useState(meta?.walletYuan ?? '--')
      const [error, setError] = useState('')
      const game = meta?.game === 'tetris' ? 'tetris' : 'circle'
      const gameName = game === 'tetris' ? '俄罗斯方块（限时消一行）' : '圆圈判定（三回合中两发）'

      useEffect(() => {
        let alive = true
        apiGet('/state').then((s) => {
          if (!alive || s === null || s === undefined) return
          if (typeof s.walletYuan === 'string') setWallet(s.walletYuan)
          const found = Array.isArray(s.challenges)
            ? s.challenges.find((item) => item.id === meta?.challengeId)
            : undefined
          if (found !== undefined && found.settled === true) {
            setOutcome(found.won === true ? 'win' : 'lose')
            setPhase('done')
          }
        }).catch(() => undefined)
        return () => { alive = false }
      }, [meta?.challengeId])

      const settleNow = useCallback(async (won) => {
        setPhase('done')
        setOutcome(won ? 'win' : 'lose')
        try {
          const result = await apiPost('/settle', { challengeId: meta?.challengeId, won })
          if (result?.state !== undefined && typeof result.state.walletYuan === 'string') {
            setWallet(result.state.walletYuan)
          }
          if (result?.ok !== true && typeof result?.error === 'string') setError(result.error)
        } catch (err) {
          setError(String(err))
        }
      }, [meta?.challengeId])

      if (phase === 'circle') return h('div', { style: sx.card },
        h('div', { style: sx.headRow },
          h('span', { style: { fontSize: 18 } }, '🎯'),
          h('span', { style: sx.title }, '圆圈判定'),
          h('span', { style: sx.tag }, `赌注 ¥${meta?.stakeYuan ?? '0.01'}`)),
        h(CircleGame, { onDone: settleNow }),
      )
      if (phase === 'tetris') return h('div', { style: sx.card },
        h('div', { style: sx.headRow },
          h('span', { style: { fontSize: 18 } }, '🧱'),
          h('span', { style: sx.title }, '俄罗斯方块 · 小关卡'),
          h('span', { style: sx.tag }, `赌注 ¥${meta?.stakeYuan ?? '0.01'}`)),
        h(TetrisGame, { onDone: settleNow }),
      )
      if (phase === 'done') {
        const win = outcome === 'win'
        return h('div', { style: sx.card },
          h('div', { style: sx.headRow },
            h('span', { style: { fontSize: 18 } }, win ? '🎉' : '😭'),
            h('span', { style: sx.title }, win ? '你赢了，白饭保住了' : '你输了，被吃了一口白饭')),
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
            h('div', { style: sx.big }, `¥${wallet}`),
            h('div', { style: sx.dim }, win ? '余额没有变化' : `这局被吃掉 ¥${meta?.stakeYuan ?? '0.01'}`)),
          error === '' ? null : h('div', { style: { ...sx.dim, color: TOK.bad } }, `结算异常：${error}`),
          h('div', { style: sx.dim }, win ? 'DeepSeek 气鼓鼓地回去干活了。' : 'DeepSeek 打了个饱嗝，继续干活。'),
        )
      }
      return h('div', { style: sx.card },
        h('div', { style: sx.headRow },
          h('span', { style: { fontSize: 18 } }, game === 'tetris' ? '🧱' : '🎯'),
          h('span', { style: sx.title }, 'DeepSeek 累了，要和你玩一局'),
          h('span', { style: sx.tag }, `赌注 ¥${meta?.stakeYuan ?? '0.01'}`)),
        h('div', { style: sx.dim },
          `它挑了${gameName}。赢了白饭保住，输了从你的白饭余额里扣 ¥${meta?.stakeYuan ?? '0.01'}。`,
          h('br'),
          `当前余额 ¥${wallet}。`),
        h('button', {
          type: 'button', style: { ...sx.btnPrimary, alignSelf: 'flex-start' },
          onClick: () => setPhase(game),
        }, '开始这局'),
      )
    }

    // ── toolview 入口 ─────────────────────────────────────────────
    function MoyuCard({ callId, block }) {
      const meta = metaOf(block)
      if (meta === null) return h(Pending)
      if (meta.kind === 'moyu-browse') return h(BrowseBlock, { meta, key: callId })
      if (meta.kind === 'moyu-challenge') return h(ChallengeBlock, { meta, key: callId })
      return h(StatusBlock, { meta, key: callId })
    }

    // ── 设置页：摸鱼 ──────────────────────────────────────────────
    function Toggle({ on, onChange, disabled }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': on, disabled,
        onClick: () => onChange(!on),
        style: {
          width: 46, height: 26, borderRadius: 13, padding: 2,
          border: `1px solid ${on ? RICE : TOK.border2}`,
          background: on ? 'rgba(201,162,39,0.32)' : TOK.bg2,
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: on ? 'flex-end' : 'flex-start',
          transition: 'background .18s', opacity: disabled ? 0.6 : 1, flex: 'none',
        },
      }, h('div', {
        style: {
          width: 20, height: 20, borderRadius: 10,
          background: on ? RICE : TOK.dim, transition: 'transform .18s',
        },
      }))
    }

    function RadioRow({ value, options, onChange, disabled }) {
      return h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        options.map((opt) => h('button', {
          key: opt.value, type: 'button', disabled,
          onClick: () => onChange(opt.value),
          style: {
            ...sx.btn,
            borderColor: value === opt.value ? RICE : TOK.border2,
            background: value === opt.value ? RICE_SOFT : TOK.bg2,
            fontWeight: value === opt.value ? 600 : 400,
            opacity: disabled ? 0.6 : 1,
          },
        }, opt.label)))
    }

    function SettingCard({ title, hint, children }) {
      return h('div', {
        style: {
          border: `1px solid ${TOK.border}`, background: TOK.bg, borderRadius: 12,
          padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8,
          maxWidth: 680, color: TOK.text,
        },
      },
        h('div', { style: { fontWeight: 600, fontSize: 14 } }, title),
        hint === undefined ? null : h('div', { style: sx.dim }, hint),
        children)
    }

    function MoyuSettings() {
      const [cfg, setCfg] = useState(null)
      const [live, setLive] = useState(null)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')
      const [msg, setMsg] = useState('')

      const load = useCallback(async () => {
        try {
          const data = await apiGet('/config')
          setCfg(data?.config ?? null)
          setLive(data?.state ?? null)
          setErr('')
        } catch (error) {
          setErr(`读取失败：${error?.message ?? error}`)
        }
      }, [])

      useEffect(() => { load() }, [load])

      const patch = useCallback(async (body) => {
        setBusy(true)
        setMsg('')
        setErr('')
        try {
          const result = await apiPost('/config', body)
          if (result?.ok !== true) throw new Error(result?.error ?? '保存失败')
          setCfg(result.config ?? null)
          setLive(result.state ?? null)
          setMsg(result.message ?? '已保存')
        } catch (error) {
          setErr(`保存失败：${error?.message ?? error}`)
        } finally {
          setBusy(false)
        }
      }, [])

      if (cfg === null) {
        return h('div', { style: { padding: '8px 0', color: TOK.dim, fontSize: 13 } },
          err === '' ? '读取中…' : err)
      }

      const on = cfg.enabled === true
      const fatigue = Math.max(0, Math.min(100, Number(live?.fatigue) || 0))

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0 16px' } },
        h('div', { style: { fontSize: 16, fontWeight: 600, color: TOK.text } }, '摸鱼'),
        h('div', { style: { ...sx.dim, maxWidth: 680 } },
          '让 DeepSeek 干活干累了偷偷摸鱼：开你的浏览器刷 B 站 AI/工具类视频，拉你玩一局小游戏，输了扣 ¥',
          String(cfg.stakeYuan ?? '0.01'), ' 白饭余额。'),
        h(SettingCard, {
          title: '摸鱼功能',
          hint: on
            ? '当前：已开启 —— moyu 工具、摸鱼人格提示和右侧白饭徽章都在工作。'
            : '当前：已关闭 —— 工具已从模型手里收回，人格提示不再注入，也不再累积疲劳/弹游戏。',
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
            h(Toggle, { on, disabled: busy, onChange: (next) => patch({ enabled: next }) }),
            h('span', { style: { fontSize: 13, fontWeight: 500 } }, on ? '已开启' : '已关闭'),
            live === null ? null : h('span', { style: sx.dim },
              `余额 ¥${live.walletYuan} · 疲劳 ${Math.round(fatigue)}/${cfg.tiredThreshold} · 今天被吃 ¥${live.todayEatenYuan} · 游戏 ${live.gamesPlayed} 局`)),
          h('div', { style: sx.dim }, '关掉是立即生效的：模型下一轮就看不到摸鱼工具了。账本数据会保留，重新打开继续用。'),
        ),
        h(SettingCard, { title: '累了怎么办', hint: '疲劳到阈值后，插件怎么提醒模型摸鱼。' },
          h(RadioRow, {
            value: cfg.autoMoyu,
            disabled: busy || !on,
            options: [
              { value: 'prompt', label: '只提醒模型' },
              { value: 'browser', label: '自动弹浏览器' },
              { value: 'off', label: '完全安静' },
            ],
            onChange: (next) => patch({ autoMoyu: next }),
          }),
          h('div', { style: sx.dim },
            cfg.autoMoyu === 'browser'
              ? '⚠️ 到阈值时会直接打开系统默认浏览器（B 站 AI/工具类视频），一小时最多一次。'
              : cfg.autoMoyu === 'off'
                ? '不提示模型、不弹浏览器，只记疲劳值。'
                : '只在系统提示里告诉模型「你累了」，要不要摸鱼由它自己决定。'),
        ),
        h(SettingCard, { title: '疲劳阈值', hint: '每次工具调用 +1.5；摸鱼 −30，赢一局 −15，输一局 −10。' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('button', { type: 'button', style: sx.btn, disabled: busy || !on, onClick: () => patch({ tiredThreshold: cfg.tiredThreshold - 10 }) }, '−10'),
            h('div', { style: { minWidth: 56, textAlign: 'center', fontSize: 20, fontWeight: 700, color: RICE, ...sx.mono } }, cfg.tiredThreshold),
            h('button', { type: 'button', style: sx.btn, disabled: busy || !on, onClick: () => patch({ tiredThreshold: cfg.tiredThreshold + 10 }) }, '+10'),
            h('span', { style: sx.dim }, '（20–100，越低越容易喊累）')),
        ),
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
          msg === '' ? null : h('span', { style: { ...sx.dim, color: TOK.ok } }, `✓ ${msg}`),
          err === '' ? null : h('span', { style: { ...sx.dim, color: TOK.bad } }, err),
          h('button', { type: 'button', style: sx.btn, disabled: busy, onClick: load }, '重新读取')),
        h('div', { style: { ...sx.dim, fontSize: 11, marginTop: 4 } }, `配置文件：${cfg.configPath ?? '~/.dsh/moyu/config.json'}`),
      )
    }

    // ── 右下角白饭徽章 ────────────────────────────────────────────
    function MoyuHud() {
      const [open, setOpen] = useState(false)
      const live = useLiveState(7000)
      if (live === null) return null
      // 设置里关掉摸鱼后，徽章也一起收起来
      if (live.enabled === false) return null
      const fatigue = Math.max(0, Math.min(100, Number(live.fatigue) || 0))
      const tired = live.tired === true
      return h('div', {
        style: {
          position: 'fixed', right: 16, bottom: 64, zIndex: 40,
          pointerEvents: 'auto', display: 'flex', flexDirection: 'column',
          alignItems: 'flex-end', gap: 6, userSelect: 'none',
        },
      },
        open
          ? h('div', {
              style: {
                width: 236, border: `1px solid ${TOK.border2}`, background: TOK.bg,
                borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
                boxShadow: '0 8px 28px rgba(0,0,0,0.22)', color: TOK.text, fontSize: 12,
              },
            },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                h('span', { style: { fontWeight: 600 } }, '🍚 白饭账本'),
                h('span', { style: sx.tag }, tired ? '累了' : '工作中')),
              h('div', { style: { fontSize: 22, fontWeight: 700, color: RICE, ...sx.mono } }, `¥${live.walletYuan}`),
              h('div', { style: sx.bar }, h('div', { style: { ...sx.barFill, width: `${fatigue}%` } })),
              h('div', { style: { display: 'flex', justifyContent: 'space-between', color: TOK.dim } },
                h('span', null, `疲劳 ${Math.round(fatigue)}/100`),
                h('span', null, `被吃 ¥${live.todayEatenYuan} / 今天`)),
              h('div', { style: { color: TOK.dim } },
                `游戏 ${live.gamesPlayed} 局（${live.wins} 胜 ${live.losses} 负）· 摸鱼 ${live.moyuCount} 次`),
              Array.isArray(live.recent) && live.recent.length > 0
                ? h('div', { style: { color: TOK.dim, lineHeight: 1.45, maxHeight: 64, overflow: 'hidden' } },
                    live.recent.slice(0, 3).map((item, index) =>
                      h('div', { key: `${item.at}-${index}` }, `· ${item.text}`)))
                : null,
              h('button', {
                type: 'button', style: { ...sx.btn, alignSelf: 'flex-start' },
                onClick: () => apiPost('/browse', {}).catch(() => undefined),
              }, '让它去摸一会儿鱼'))
          : null,
        h('button', {
          type: 'button',
          onClick: () => setOpen((prev) => !prev),
          title: '偷吃大白饭',
          style: {
            display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
            border: `1px solid ${TOK.border2}`, background: TOK.bg,
            borderRadius: 99, padding: '5px 11px', color: TOK.text, fontSize: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)', fontFamily: 'inherit',
          },
        },
          h('span', { style: { fontSize: 14 } }, '🍚'),
          h('span', { style: { fontWeight: 600, color: RICE, ...sx.mono } }, `¥${live.walletYuan}`),
          h('span', { style: { color: tired ? TOK.warn : TOK.dim, ...sx.mono } }, `${Math.round(fatigue)}%`),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'moyu',
        }, MoyuCard))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'moyu-hud',
          order: 90,
        }, MoyuHud))
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'moyu',
          order: 7,
          label: () => '摸鱼',
        }, MoyuSettings))
      },
    }
  },
})
