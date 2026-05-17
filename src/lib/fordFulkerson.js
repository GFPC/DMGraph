/**
 * Максимальный поток по методу Форда–Фалкерсона.
 * Увеличивающие пути ищутся обходом в ширину (Эдмондс–Карп) — полиномиальная
 * версия того же общего каркаса FF.
 */

function cloneMatrix(m) {
  return m.map((row) => row.slice())
}

/**
 * @param {number[][]} capacities — матрица пропускных способностей (направленное ребро u→v)
 * @param {number} source
 * @param {number} sink
 * @returns {{ maxFlow: number, augmentations: Array<{ path: number[], bottleneck: number }> }}
 */
export function fordFulkerson(capacities, source, sink) {
  const n = capacities.length
  let residual = cloneMatrix(capacities)
  const augmentations = []
  let maxFlow = 0

  if (source === sink || n === 0) {
    return { maxFlow: 0, augmentations: [] }
  }

  while (true) {
    const parent = Array(n).fill(-1)
    const visited = Array(n).fill(false)
    const queue = []

    visited[source] = true
    queue.push(source)

    while (queue.length && parent[sink] === -1) {
      const u = queue.shift()
      for (let v = 0; v < n; v++) {
        if (!visited[v] && residual[u][v] > 0) {
          visited[v] = true
          parent[v] = u
          queue.push(v)
        }
      }
    }

    if (parent[sink] === -1) break

    let pathFlow = Infinity
    for (let v = sink; v !== source; v = parent[v]) {
      const u = parent[v]
      pathFlow = Math.min(pathFlow, residual[u][v])
    }

    const path = []
    for (let v = sink; v !== source; v = parent[v]) {
      path.push(v)
    }
    path.push(source)
    path.reverse()

    for (let v = sink; v !== source; v = parent[v]) {
      const u = parent[v]
      residual[u][v] -= pathFlow
      residual[v][u] += pathFlow
    }

    augmentations.push({ path, bottleneck: pathFlow })
    maxFlow += pathFlow
  }

  return { maxFlow, augmentations, residualFinal: residual }
}

export function indexMap(nodeIds, id) {
  const i = nodeIds.indexOf(id)
  return i
}

/** Суммирует параллельные рёбра одного направления в одну матрицу cap[u][v] */
export function edgesToCapacityMatrix(nodeIds, edges) {
  const n = nodeIds.length
  const cap = Array.from({ length: n }, () => Array(n).fill(0))
  for (const e of edges) {
    const u = nodeIds.indexOf(e.from)
    const v = nodeIds.indexOf(e.to)
    if (u >= 0 && v >= 0 && u !== v) {
      cap[u][v] += Math.max(0, Number(e.capacity) || 0)
    }
  }
  return cap
}
