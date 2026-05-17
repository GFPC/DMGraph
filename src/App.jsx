import { useCallback, useEffect, useMemo, useState } from 'react'
import { edgesToCapacityMatrix, fordFulkerson } from './lib/fordFulkerson'
import './App.css'

const VIEW_W = 920
const VIEW_H = 460
/** Отступ от края до центра узла (radius до 40 на таче) */
const VIEW_MARGIN = 46

function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

const DEFAULT_NODES = [
  { id: 'warehouse', label: 'Склад' },
  { id: 'w1', label: 'Цех 1' },
  { id: 'w2', label: 'Цех 2' },
  { id: 'w3', label: 'Цех 3' },
  { id: 'assembly', label: 'Оконч. сборка' },
]

const DEFAULT_EDGES = [
  { id: uid('e'), from: 'warehouse', to: 'w1', capacity: 10 },
  { id: uid('e'), from: 'warehouse', to: 'w2', capacity: 8 },
  { id: uid('e'), from: 'w1', to: 'w2', capacity: 3 },
  { id: uid('e'), from: 'w1', to: 'w3', capacity: 7 },
  { id: uid('e'), from: 'w2', to: 'w3', capacity: 6 },
  { id: uid('e'), from: 'w3', to: 'assembly', capacity: 12 },
]

function clientPointToSvg(svg, clientX, clientY) {
  try {
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) throw new Error('no_ctm')
    const svgP = pt.matrixTransform(ctm.inverse())
    return { x: svgP.x, y: svgP.y }
  } catch {
    const r = svg.getBoundingClientRect()
    const vb = svg.viewBox?.baseVal
    if (!vb || vb.width <= 0 || r.width <= 0) return { x: 0, y: 0 }
    const x = ((clientX - r.left) / r.width) * vb.width + vb.x
    const y = ((clientY - r.top) / r.height) * vb.height + vb.y
    return { x, y }
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

const DEFAULT_POS = {
  warehouse: { x: 80, y: 220 },
  w1: { x: 280, y: 120 },
  w2: { x: 280, y: 320 },
  w3: { x: 520, y: 220 },
  assembly: { x: 740, y: 220 },
}

function useCompactTouchUi() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    const q = window.matchMedia('(max-width: 639px), (pointer: coarse)')
    function sync() {
      setOk(q.matches)
    }
    sync()
    q.addEventListener('change', sync)
    return () => q.removeEventListener('change', sync)
  }, [])
  return ok
}

export default function App() {
  const compactTouchUi = useCompactTouchUi()

  const [tab, setTab] = useState('app')
  const [nodes, setNodes] = useState(DEFAULT_NODES)
  const [edges, setEdges] = useState(DEFAULT_EDGES)
  const [sourceId, setSourceId] = useState('warehouse')
  const [sinkId, setSinkId] = useState('assembly')
  const [positions, setPositions] = useState(DEFAULT_POS)

  const [newNodeLabel, setNewNodeLabel] = useState('')
  const [newEdge, setNewEdge] = useState({ from: '', to: '', capacity: 5 })

  const [result, setResult] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [drag, setDrag] = useState(null)

  useEffect(() => {
    if (!drag) return
    const svg = document.getElementById('graph-svg')
    if (!svg) return

    const { pointerId: pid, captureEl } = drag

    function move(ev) {
      if (ev.pointerId !== pid) return
      const svgP = clientPointToSvg(svg, ev.clientX, ev.clientY)
      const x = clamp(svgP.x - drag.offsetX, VIEW_MARGIN, VIEW_W - VIEW_MARGIN)
      const y = clamp(svgP.y - drag.offsetY, VIEW_MARGIN, VIEW_H - VIEW_MARGIN)
      ev.preventDefault()
      setPositions((prev) => ({
        ...prev,
        [drag.id]: { x, y },
      }))
    }

    function detach() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }

    function end(ev) {
      if (ev.pointerId !== pid) return
      detach()
      try {
        captureEl.releasePointerCapture?.(pid)
      } catch {
        /* ignore */
      }
      setDrag(null)
    }

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)

    return () => {
      detach()
      try {
        captureEl.releasePointerCapture?.(pid)
      } catch {
        /* ignore */
      }
    }
  }, [drag])

  const nodeIds = useMemo(() => nodes.map((n) => n.id), [nodes])

  const caps = useMemo(() => edgesToCapacityMatrix(nodeIds, edges), [nodeIds, edges])

  const run = useCallback(() => {
    const si = nodeIds.indexOf(sourceId)
    const ti = nodeIds.indexOf(sinkId)
    if (si < 0 || ti < 0) {
      setResult({ error: 'Укажите корректные источник и сток.' })
      return
    }
    if (si === ti) {
      setResult({ error: 'Источник и сток не должны совпадать для расчёта потока.' })
      return
    }
    const { maxFlow, augmentations } = fordFulkerson(caps, si, ti)
    setResult({
      maxFlow,
      augmentations,
      si,
      ti,
      error: null,
    })
    setStepIndex(0)
  }, [caps, nodeIds, sinkId, sourceId])

  const aug = result?.augmentations
  const currentPathSet = useMemo(() => {
    if (!aug?.length) return null
    const clamped = Math.min(stepIndex, aug.length - 1)
    const path = aug[clamped]?.path ?? []
    const set = new Set()
    for (let i = 0; i < path.length - 1; i++) {
      set.add(`${path[i]}→${path[i + 1]}`)
    }
    return set
  }, [aug, stepIndex])

  const highlightEdge = useCallback(
    (fromIdx, toIdx) => {
      const key = `${fromIdx}→${toIdx}`
      return currentPathSet?.has(key)
    },
    [currentPathSet],
  )

  function onPointerDownSvg(e, id) {
    if (e.pointerType === 'mouse' && e.button !== 0) return

    const el = e.currentTarget
    const svg = el.closest('svg')
    if (!svg) return
    const p = positions[id]
    const svgP = clientPointToSvg(svg, e.clientX, e.clientY)
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }

    setDrag({
      id,
      offsetX: svgP.x - p.x,
      offsetY: svgP.y - p.y,
      pointerId: e.pointerId,
      captureEl: el,
    })
    e.preventDefault()
  }

  function addNode() {
    const label = newNodeLabel.trim() || `Узел ${nodes.length + 1}`
    const id = uid('node')
    setNodes((n) => [...n, { id, label }])
    setPositions((p) => ({ ...p, [id]: { x: 400, y: 200 } }))
    setNewNodeLabel('')
  }

  function removeNode(id) {
    if (nodes.length <= 2) return
    const remaining = nodes.filter((x) => x.id !== id)
    let nextSource = sourceId === id ? remaining[0].id : sourceId
    let nextSink = sinkId === id ? remaining[remaining.length - 1].id : sinkId
    if (nextSink === nextSource && remaining.length > 1) {
      nextSink = remaining.find((n) => n.id !== nextSource)?.id ?? nextSink
    }
    setNodes(remaining)
    setSourceId(nextSource)
    setSinkId(nextSink)
    setEdges((e0) => e0.filter((x) => x.from !== id && x.to !== id))
    setPositions((p) => {
      const next = { ...p }
      delete next[id]
      return next
    })
  }

  function addEdge() {
    const from = newEdge.from
    const to = newEdge.to
    const cap = Math.max(0, Number(newEdge.capacity) || 0)
    if (!from || !to || from === to) return
    setEdges((e) => [...e, { id: uid('e'), from, to, capacity: cap }])
  }

  function loadPreset(which) {
    if (which === 'factory') {
      setNodes(DEFAULT_NODES)
      setEdges(DEFAULT_EDGES.map((x) => ({ ...x, id: uid('e') })))
      setSourceId('warehouse')
      setSinkId('assembly')
      setPositions({ ...DEFAULT_POS })
    } else if (which === 'simple') {
      const n = [
        { id: 's', label: 'S' },
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 't', label: 'T' },
      ]
      setNodes(n)
      setEdges([
        { id: uid('e'), from: 's', to: 'a', capacity: 10 },
        { id: uid('e'), from: 's', to: 'b', capacity: 5 },
        { id: uid('e'), from: 'a', to: 'b', capacity: 15 },
        { id: uid('e'), from: 'a', to: 't', capacity: 10 },
        { id: uid('e'), from: 'b', to: 't', capacity: 10 },
      ])
      setSourceId('s')
      setSinkId('t')
      setPositions({
        s: { x: 90, y: 200 },
        a: { x: 340, y: 110 },
        b: { x: 340, y: 290 },
        t: { x: 590, y: 200 },
      })
    }
    setResult(null)
    setStepIndex(0)
  }

  const stepAug = aug && aug.length ? aug[Math.min(stepIndex, aug.length - 1)] : null
  const cumulativeAfterStep =
    aug && aug.length
      ? aug.slice(0, Math.min(stepIndex + 1, aug.length)).reduce((s, x) => s + x.bottleneck, 0)
      : 0

  const clampedStep = aug?.length ? Math.min(stepIndex, aug.length - 1) : 0

  const graphNodeRadius = compactTouchUi ? 40 : 30
  const edgeEndInset = compactTouchUi ? 36 : 28
  const labelDy = compactTouchUi ? 6 : 5
  const hintDy = graphNodeRadius + 14

  return (
    <div className="layout">
      <header className="header">
        <div>
          <div className="header-kicker">Max flow · Ford–Fulkerson</div>
          <h1 className="title">
            Транспортная сеть цеха ·{' '}
            <span className="title-accent">максимальный поток</span>
          </h1>
          <p className="subtitle">
            Модель: направленный граф, рёбра — маршруты с ограниченной пропускной способностью. Алгоритм Форда–Фалкерсона
            (поиск увеличивающего пути в остаточной сети методом{' '}
            <abbr title="Обход в ширину для полиномиальной сложности">BFS</abbr>, классический вариант Эдмондса–Карпа).
          </p>
        </div>
      </header>

      <nav className="tabs" aria-label="Разделы">
        <button type="button" className={tab === 'app' ? 'tab active' : 'tab'} onClick={() => setTab('app')}>
          Программа
        </button>
        <button type="button" className={tab === 'model' ? 'tab active' : 'tab'} onClick={() => setTab('model')}>
          Модель и алгоритм
        </button>
        <button type="button" className={tab === 'lifecycle' ? 'tab active' : 'tab'} onClick={() => setTab('lifecycle')}>
          Жизненный цикл проекта
        </button>
      </nav>

      {tab === 'lifecycle' && (
        <section className="panel prose">
          <h2>Итеративная модель (4 фазы)</h2>
          <ul>
            <li>
              <strong>Инициализация</strong> — постановка проблемы, цели темы («максимальный поток в сети от склада к окончательной сборке»),
              распределение ролей в команде.
            </li>
            <li>
              <strong>Проектирование</strong> — переход от производственного описания к сетевой модели, выбор алгоритма (Форд–Фалкерсон) и средств (React/Vite).
            </li>
            <li>
              <strong>Выполнение</strong> — разработка, тестирование, примеры расчётов, подготовка отчётов и демонстрации.
            </li>
            <li>
              <strong>Применение</strong> — защита, выводы, самооценка результатов и загрузка материалов в ЭОР.
            </li>
          </ul>
          <p className="muted">
            Промежуточные решения можно уточнять на любом этапе после обратной связи преподавателя и по итогам демонстрации.
          </p>
        </section>
      )}

      {tab === 'model' && (
        <section className="panel prose">
          <h2>Математическая модель</h2>
          <p>
            Пусть <span className="mono">G = (V, E)</span> — орграф вершин (цехов и склада). Каждому ребру{' '}
            <span className="mono">(u, v)</span> сопоставлена неотрицательная пропускная способность{' '}
            <span className="mono">c(u, v)</span>. Из склада задаётся источник <span className="mono">s</span>, цех окончательной
            сборки — сток <span className="mono">t</span>. Требуется найти значение максимального потока из{' '}
            <span className="mono">s</span> в <span className="mono">t</span>, не нарушающее ограничения на рёбрах и сохранение
            потока в промежуточных вершинах.
          </p>
          <h3>Обоснование алгоритма</h3>
          <p>
            Теорема Форда–Фалкерсона: максимальный поток равен минимальному разрезу; итеративное нахождение увеличивающих путей в остаточной
            сети сходится к оптимуму при целочисленных пропускных способностях. Поиск пути методом обхода в ширину даёт хорошую предсказуемость
            по числу шагов на практических сетях и удобен для показа итераций в интерфейсе.
          </p>
          <h3>Верификация</h3>
          <p>
            После расчёта сравните суммарный исходящий поток от источника (и входящий к стоку) с суммой величин шагов; на графе подсвечивается текущее
            увеличивающее подмножество рёбер пути на выбранном шаге.
          </p>
        </section>
      )}

      {tab === 'app' && (
        <>
          <div className="grid-main">
            <section className="panel graph-panel">
              <div className="toolbar graph-toolbar">
                <span className="badge">Граф</span>
                <button type="button" className="btn secondary" onClick={() => loadPreset('factory')}>
                  Пример «завод»
                </button>
                <button type="button" className="btn secondary" onClick={() => loadPreset('simple')}>
                  Классический пример S–T
                </button>
              </div>
              <svg
                id="graph-svg"
                className={`graph-svg${compactTouchUi ? ' graph-svg--touch' : ''}`}
                viewBox="0 0 920 460"
                role="img"
                aria-label="Сеть цехов — перетаскивайте круги, чтобы расставить узлы"
              >
                <defs>
                  <linearGradient id="stepRingStroke" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={920} y2={460}>
                    <stop offset="0%" stopColor="#40e9ff" />
                    <stop offset="50%" stopColor="#d4fc38" />
                    <stop offset="100%" stopColor="#9b87ff" />
                  </linearGradient>
                  <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                    <path d="M 0 0 L 9 4.5 L 0 9 z" fill="var(--muted-2)" opacity="0.85" />
                  </marker>
                </defs>
                {edges.map((e) => {
                  const ui = nodeIds.indexOf(e.from)
                  const vi = nodeIds.indexOf(e.to)
                  if (ui < 0 || vi < 0) return null
                  const p1 = positions[e.from]
                  const p2 = positions[e.to]
                  if (!p1 || !p2) return null

                  const dx = p2.x - p1.x
                  const dy = p2.y - p1.y
                  const len = Math.sqrt(dx * dx + dy * dy) || 1
                  const r = edgeEndInset
                  const x1 = p1.x + (dx / len) * r
                  const y1 = p1.y + (dy / len) * r
                  const x2 = p2.x - (dx / len) * r
                  const y2 = p2.y - (dy / len) * r

                  const midX = (x1 + x2) / 2
                  const midY = (y1 + y2) / 2
                  const nx = -(dy / len) * 10
                  const ny = (dx / len) * 10
                  const cx = midX + nx
                  const cy = midY + ny

                  const active = highlightEdge(ui, vi)
                  return (
                    <g key={e.id}>
                      {active ? (
                        <path
                          d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                          fill="none"
                          stroke="var(--lime)"
                          strokeOpacity="0.35"
                          strokeWidth="11"
                          strokeLinecap="round"
                        />
                      ) : null}
                      <path
                        d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                        fill="none"
                        stroke={active ? 'var(--lime)' : 'rgba(255,255,255,0.14)'}
                        strokeWidth={active ? 5 : 2.25}
                        strokeLinecap="round"
                        markerEnd="url(#arrow)"
                        opacity={active ? 1 : 0.92}
                      />
                      <foreignObject x={cx - 28} y={cy - 18} width="56" height="36">
                        <div className={`edge-cap ${active ? 'active' : ''}`}>{e.capacity}</div>
                      </foreignObject>
                    </g>
                  )
                })}
                {nodes.map((n, idx) => {
                  const p = positions[n.id] ?? { x: 120, y: 120 }
                  const isS = n.id === sourceId
                  const isT = n.id === sinkId
                  const ring = Boolean(stepAug?.path?.includes(idx))

                  return (
                    <g key={n.id}>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={graphNodeRadius + 22}
                        fill="transparent"
                        stroke="none"
                        className="graph-hit"
                        aria-hidden
                        onPointerDown={(ev) => onPointerDownSvg(ev, n.id)}
                      />
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={graphNodeRadius}
                        className={`node-disk ${isS ? 'src' : ''} ${isT ? 'snk' : ''} ${ring ? 'ring' : ''}`}
                        pointerEvents="none"
                      />
                      {Boolean(stepAug?.path?.length) && ring ? (
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={graphNodeRadius + 10}
                          fill="none"
                          stroke="url(#stepRingStroke)"
                          strokeWidth="2.5"
                          opacity={0.9}
                          pointerEvents="none"
                        />
                      ) : null}
                      <text x={p.x} y={p.y + labelDy} textAnchor="middle" className="node-label" pointerEvents="none">
                        {n.label}
                      </text>
                      {isS && isT ? (
                        <text x={p.x} y={p.y - hintDy} textAnchor="middle" className="hint" pointerEvents="none">
                          источник = сток
                        </text>
                      ) : (
                        <>
                          {isS ? (
                            <text x={p.x} y={p.y - hintDy} textAnchor="middle" className="hint" pointerEvents="none">
                              источник
                            </text>
                          ) : null}
                          {isT ? (
                            <text x={p.x} y={p.y - hintDy} textAnchor="middle" className="hint" pointerEvents="none">
                              сток
                            </text>
                          ) : null}
                        </>
                      )}
                    </g>
                  )
                })}
              </svg>
              <p className="muted small graph-help">
                {compactTouchUi
                  ? 'Перетащите узел большим серым диском: у хит-зоны увеличенный радиус. Ниже — таблицы рёбер; страница не «уезжает», пока двигаете вершину.'
                  : 'Узлы перетаскиваются мышью. Пропускные способности — в таблице справа.'}
              </p>
            </section>

            <aside className="panel side">
              <div className="side-fixed">
                <h2 className="panel-title">Параметры сети</h2>

                <div className="field-row">
                  <label>
                    Источник <span className="mono">s</span>
                    <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Сток <span className="mono">t</span>
                    <select value={sinkId} onChange={(e) => setSinkId(e.target.value)}>
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="actions">
                  <button type="button" className="btn primary" onClick={run}>
                    Вычислить max-flow
                  </button>
                </div>

                {result?.error && <p className="alert">{result.error}</p>}

                {result && !result.error && (
                  <div className="result-card">
                    <div className="result-main">
                      Максимальный поток: <strong className="mono">{result.maxFlow}</strong>
                    </div>
                    <div className="muted small">Число итераций (увеличивающих путей): {result.augmentations.length}</div>
                    {(aug?.length ?? 0) > 0 && (
                      <>
                        <label className="step-label">
                          Шаг аугментации: {clampedStep + 1} / {aug.length}
                          <span className="mono subtle">
                            {' '}
                            · поток шага {stepAug.bottleneck} · нарастающая сумма {cumulativeAfterStep}
                          </span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0, aug.length - 1)}
                          value={clampedStep}
                          onChange={(e) => setStepIndex(Number(e.target.value))}
                        />
                        <p className="mono path-line">
                          Путь:{' '}
                          {stepAug.path
                            .map((i) => nodes[i]?.label ?? i)
                            .join(' → ')}
                        </p>
                      </>
                    )}
                  </div>
                )}

                <hr className="sep side-sep" />
                <p className="side-scroll-hint muted small">
                  Списки ниже можно прокручивать отдельно{compactTouchUi ? '' : ' · граф слева остаётся на экране на ПК'}.
                </p>
              </div>

              <div className="side-scroll" role="region" aria-label="Узлы и рёбра сети">
                <h3 className="subsection">Узлы</h3>
                <div className="inline">
                  <input placeholder="Название цеха" value={newNodeLabel} onChange={(e) => setNewNodeLabel(e.target.value)} />
                  <button type="button" className="btn secondary" onClick={addNode}>
                    Добавить
                  </button>
                </div>
                <ul className="node-list">
                  {nodes.map((n) => (
                    <li key={n.id}>
                      <span className="mono">{n.label}</span>
                      <button type="button" className="link danger" onClick={() => removeNode(n.id)}>
                        удалить
                      </button>
                    </li>
                  ))}
                </ul>

                <h3 className="subsection">Рёбра и пропускная способность</h3>
                <div className="edge-form">
                  <select value={newEdge.from} onChange={(e) => setNewEdge((x) => ({ ...x, from: e.target.value }))}>
                    <option value="">из…</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                  <select value={newEdge.to} onChange={(e) => setNewEdge((x) => ({ ...x, to: e.target.value }))}>
                    <option value="">в…</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={newEdge.capacity}
                    onChange={(e) => setNewEdge((x) => ({ ...x, capacity: e.target.value }))}
                  />
                  <button type="button" className="btn secondary" onClick={addEdge}>
                    Добавить ребро
                  </button>
                </div>

                <div className="edges-table-wrap">
                  <table className="edges-table">
                    <thead>
                      <tr>
                        <th>От</th>
                        <th>К</th>
                        <th>Спр.</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {edges.map((e) => {
                        const fromLabel = nodes.find((n) => n.id === e.from)?.label ?? ''
                        const toLabel = nodes.find((n) => n.id === e.to)?.label ?? ''
                        return (
                          <tr key={e.id}>
                            <td title={fromLabel}>
                              <span className="cell-label">{fromLabel}</span>
                            </td>
                            <td title={toLabel}>
                              <span className="cell-label">{toLabel}</span>
                            </td>
                            <td className="edges-table-cap">
                              <input
                                className="cell-input mono"
                                type="number"
                                min={0}
                                value={e.capacity}
                                onChange={(ev) =>
                                  setEdges((list) =>
                                    list.map((x) => (x.id === e.id ? { ...x, capacity: Number(ev.target.value) || 0 } : x)),
                                  )
                                }
                              />
                            </td>
                            <td className="edges-table-remove">
                              <button type="button" className="link danger" onClick={() => setEdges((x) => x.filter((z) => z.id !== e.id))}>
                                ✕
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </aside>
          </div>

          <footer className="panel foot">
            Для отчётности (*.doc / *.pptx): перенесите тексты разделов «Модель и алгоритм» и «Жизненный цикл», приложите скриншоты пошаговой
            демонстрации и укажите в списке источников классический учебный материал по потокам (Форд–Фалкерсон, Эдмондс–Карп).
          </footer>
        </>
      )}
    </div>
  )
}
