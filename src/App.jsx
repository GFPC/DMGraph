import { useCallback, useEffect, useMemo, useState } from 'react'
import { edgesToCapacityMatrix, fordFulkerson } from './lib/fordFulkerson'
import './App.css'

const VIEW_W = 920
const VIEW_H = 460

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
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const svgP = pt.matrixTransform(ctm.inverse())
  return { x: svgP.x, y: svgP.y }
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

export default function App() {
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
    function move(ev) {
      const svg = document.getElementById('graph-svg')
      if (!svg) return
      const svgP = clientPointToSvg(svg, ev.clientX, ev.clientY)
      const x = clamp(svgP.x - drag.offsetX, 32, VIEW_W - 32)
      const y = clamp(svgP.y - drag.offsetY, 32, VIEW_H - 32)
      setPositions((prev) => ({
        ...prev,
        [drag.id]: { x, y },
      }))
    }
    function up() {
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
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
    if (e.button !== 0) return
    const svg = e.currentTarget.closest('svg')
    if (!svg) return
    const p = positions[id]
    const svgP = clientPointToSvg(svg, e.clientX, e.clientY)
    setDrag({
      id,
      offsetX: svgP.x - p.x,
      offsetY: svgP.y - p.y,
    })
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
              <div className="toolbar">
                <span className="badge">Граф</span>
                <button type="button" className="btn secondary" onClick={() => loadPreset('factory')}>
                  Пример «завод»
                </button>
                <button type="button" className="btn secondary" onClick={() => loadPreset('simple')}>
                  Классический пример S–T
                </button>
              </div>
              <svg id="graph-svg" className="graph-svg" viewBox="0 0 920 460" role="img" aria-label="Сеть цехов">
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
                  const r = 28
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
                        r={30}
                        className={`node-disk ${isS ? 'src' : ''} ${isT ? 'snk' : ''} ${ring ? 'ring' : ''}`}
                        onPointerDown={(ev) => onPointerDownSvg(ev, n.id)}
                      />
                      {Boolean(stepAug?.path?.length) && ring ? (
                        <circle cx={p.x} cy={p.y} r={39} fill="none" stroke="url(#stepRingStroke)" strokeWidth="2.5" opacity={0.9} />
                      ) : null}
                      <text x={p.x} y={p.y + 5} textAnchor="middle" className="node-label">
                        {n.label}
                      </text>
                      {isS && isT ? (
                        <text x={p.x} y={p.y - 42} textAnchor="middle" className="hint">
                          источник = сток
                        </text>
                      ) : (
                        <>
                          {isS ? (
                            <text x={p.x} y={p.y - 42} textAnchor="middle" className="hint">
                              источник
                            </text>
                          ) : null}
                          {isT ? (
                            <text x={p.x} y={p.y - 42} textAnchor="middle" className="hint">
                              сток
                            </text>
                          ) : null}
                        </>
                      )}
                    </g>
                  )
                })}
              </svg>
              <p className="muted small">Узлы перетаскиваются мышью. Пропускные способности редактируются в таблице справа.</p>
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
                <p className="side-scroll-hint muted small">Списки узлов и рёбер прокручиваются здесь · граф остаётся слева</p>
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
