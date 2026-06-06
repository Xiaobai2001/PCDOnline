import { ref, type Ref } from 'vue'
import {
  createObstacleGridFromPoints,
  paintOccupancyDisk,
  serializePgmBinary,
  serializeMapYaml,
  worldToGridCell,
  type OccupancyGridMap,
  type PointXY,
  type CreateObstacleGridOptions,
  FREE_GRAY,
  OCCUPIED_GRAY,
} from '@/utils/occupancyGrid'

const TILE_SIZE = 256

type TileCache = {
  map: OccupancyGridMap
  tileSize: number
  tileCols: number
  tileRows: number
  tiles: Map<string, HTMLCanvasElement>
  dirty: Set<string>
}

type Viewport = {
  centerX: number
  centerY: number
  scale: number
  width: number
  height: number
}

export function useOccupancyGrid(params: {
  gridCanvasRef: Ref<HTMLCanvasElement | null>
  getViewport: () => Viewport | null
}) {
  const grid = ref<OccupancyGridMap | null>(null)
  const showGrid = ref(true)
  const generating = ref(false)
  let tileCache: TileCache | null = null
  let renderRAF = 0
  let hoverCell: { row: number; col: number } | null = null
  let highlightedCells: Set<string> = new Set()

  const obstacleConfig = ref<CreateObstacleGridOptions>({
    resolution: 0.05,
    margin: 2,
    minCellPoints: 1,
  })

  function generateFromPoints(points: PointXY[]) {
    generating.value = true
    try {
      grid.value = createObstacleGridFromPoints(points, obstacleConfig.value)
      invalidateCache()
    } finally {
      generating.value = false
    }
  }

  function scheduleRender() {
    if (renderRAF) return
    renderRAF = requestAnimationFrame(() => {
      renderRAF = 0
      drawGrid()
    })
  }

  function paintDisk(x: number, y: number, radius: number, occupied: boolean) {
    if (!grid.value) return
    paintOccupancyDisk(grid.value, x, y, radius, occupied)
    markDirtyTilesAround(x, y, radius)
    scheduleRender()
  }

  function eraseByRect(minX: number, minY: number, maxX: number, maxY: number): number {
    if (!grid.value) return 0
    const map = grid.value
    const resolution = map.meta.resolution
    const originX = map.meta.origin[0]
    const originY = map.meta.origin[1]
    const mapW = map.image.width
    const mapH = map.image.height
    let count = 0
    const minCol = Math.max(0, Math.floor((minX - originX) / resolution))
    const maxCol = Math.min(mapW - 1, Math.floor((maxX - originX) / resolution))
    const minRowFromBottom = Math.max(0, Math.floor((minY - originY) / resolution))
    const maxRowFromBottom = Math.min(mapH - 1, Math.floor((maxY - originY) / resolution))
    for (let rowFB = minRowFromBottom; rowFB <= maxRowFromBottom; rowFB++) {
      for (let col = minCol; col <= maxCol; col++) {
        const row = mapH - 1 - rowFB
        const index = row * mapW + col
        if (map.image.data[index] !== FREE_GRAY) {
          map.image.data[index] = FREE_GRAY
          count++
        }
      }
    }
    if (count > 0) {
      invalidateCache()
      scheduleRender()
    }
    return count
  }

  function invalidateCache() {
    tileCache = grid.value
      ? {
          map: grid.value,
          tileSize: TILE_SIZE,
          tileCols: Math.ceil(grid.value.image.width / TILE_SIZE),
          tileRows: Math.ceil(grid.value.image.height / TILE_SIZE),
          tiles: new Map(),
          dirty: new Set(),
        }
      : null
  }

  function markDirtyTilesAround(x: number, y: number, radius: number) {
    if (!tileCache || !grid.value) return
    const map = grid.value
    const resolution = map.meta.resolution
    const radiusCells = Math.ceil(radius / resolution) + 1
    const centerCol = Math.floor((x - map.meta.origin[0]) / resolution)
    const centerRowBottom = Math.floor((y - map.meta.origin[1]) / resolution)
    for (let dy = -radiusCells; dy <= radiusCells; dy++) {
      for (let dx = -radiusCells; dx <= radiusCells; dx++) {
        const col = centerCol + dx
        const rowFromBottom = centerRowBottom + dy
        if (col < 0 || col >= map.image.width || rowFromBottom < 0 || rowFromBottom >= map.image.height) continue
        const topRow = map.image.height - 1 - rowFromBottom
        const tileX = Math.floor(col / tileCache.tileSize)
        const tileY = Math.floor(topRow / tileCache.tileSize)
        tileCache.dirty.add(`${tileX},${tileY}`)
      }
    }
  }

  function tileKey(tileX: number, tileY: number) {
    return `${tileX},${tileY}`
  }

  function occupancyCellStateFromGray(map: OccupancyGridMap, gray: number) {
    const normalized = map.image.maxValue > 0 ? gray / map.image.maxValue : 0
    const occupiedProbability = map.meta.negate ? normalized : 1 - normalized
    if (occupiedProbability > map.meta.occupiedThresh) return 'occupied'
    if (occupiedProbability < map.meta.freeThresh) return 'free'
    return 'unknown'
  }

  function buildTile(cache: TileCache, tileX: number, tileY: number): HTMLCanvasElement {
    const { map, tileSize } = cache
    const startCol = tileX * tileSize
    const startRow = tileY * tileSize
    const tileW = Math.min(tileSize, map.image.width - startCol)
    const tileH = Math.min(tileSize, map.image.height - startRow)
    const canvas = document.createElement('canvas')
    canvas.width = tileW
    canvas.height = tileH
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas
    const image = ctx.createImageData(tileW, tileH)
    for (let y = 0; y < tileH; y++) {
      const mapRow = startRow + y
      const mapOffset = mapRow * map.image.width + startCol
      for (let x = 0; x < tileW; x++) {
        const state = occupancyCellStateFromGray(map, map.image.data[mapOffset + x])
        const out = (y * tileW + x) * 4
        if (state === 'occupied') {
          image.data[out] = 22
          image.data[out + 1] = 163
          image.data[out + 2] = 74
          image.data[out + 3] = 235
        } else if (state === 'unknown') {
          image.data[out] = 100
          image.data[out + 1] = 116
          image.data[out + 2] = 139
          image.data[out + 3] = 140
        }
      }
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  function getTile(cache: TileCache, tileX: number, tileY: number) {
    const key = tileKey(tileX, tileY)
    let tile = cache.tiles.get(key)
    if (!tile || cache.dirty.has(key)) {
      tile = buildTile(cache, tileX, tileY)
      cache.tiles.set(key, tile)
      cache.dirty.delete(key)
    }
    return tile
  }

  function clampInt(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Math.floor(value)))
  }

  function drawGrid() {
    const canvas = params.gridCanvasRef.value
    if (!canvas) return
    const vp = params.getViewport()
    const map = grid.value
    if (!map || !showGrid.value || !vp) {
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const displayW = Math.floor(vp.width * dpr)
    const displayH = Math.floor(vp.height * dpr)
    if (canvas.width !== displayW || canvas.height !== displayH) {
      canvas.width = displayW
      canvas.height = displayH
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!tileCache || tileCache.map !== map) invalidateCache()
    const cache = tileCache
    if (!cache) return

    const originX = map.meta.origin[0]
    const originY = map.meta.origin[1]
    const resolution = map.meta.resolution
    const mapWidth = map.image.width
    const mapHeight = map.image.height

    const worldToCssPx = vp.scale
    const worldViewW = vp.width / worldToCssPx
    const worldViewH = vp.height / worldToCssPx
    const viewMinX = vp.centerX - worldViewW * 0.5
    const viewMaxX = vp.centerX + worldViewW * 0.5
    const viewMinY = vp.centerY - worldViewH * 0.5
    const viewMaxY = vp.centerY + worldViewH * 0.5

    const mapMinX = originX
    const mapMinY = originY
    const mapMaxX = originX + mapWidth * resolution
    const mapMaxY = originY + mapHeight * resolution

    if (viewMaxX < mapMinX || viewMinX > mapMaxX || viewMaxY < mapMinY || viewMinY > mapMaxY) return

    const minCol = clampInt((Math.max(viewMinX, mapMinX) - originX) / resolution, 0, mapWidth - 1)
    const maxCol = Math.max(minCol + 1, clampInt(Math.ceil((Math.min(viewMaxX, mapMaxX) - originX) / resolution), minCol + 1, mapWidth))
    const minRow = clampInt((Math.max(viewMinY, mapMinY) - originY) / resolution, 0, mapHeight - 1)
    const maxRow = Math.max(minRow + 1, clampInt(Math.ceil((Math.min(viewMaxY, mapMaxY) - originY) / resolution), minRow + 1, mapHeight))

    const worldToCanvasPx = worldToCssPx * dpr
    const cellPx = resolution * worldToCanvasPx
    const offsetX = (originX - vp.centerX) * worldToCanvasPx + canvas.width * 0.5
    const offsetY = (vp.centerY - mapMaxY) * worldToCanvasPx + canvas.height * 0.5

    ctx.imageSmoothingEnabled = false

    const minTopRow = mapHeight - maxRow
    const maxTopRow = mapHeight - minRow
    const minTileX = Math.floor(minCol / cache.tileSize)
    const maxTileX = Math.floor((maxCol - 1) / cache.tileSize)
    const minTileY = Math.floor(minTopRow / cache.tileSize)
    const maxTileY = Math.floor((maxTopRow - 1) / cache.tileSize)

    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
        if (tileX < 0 || tileY < 0 || tileX >= cache.tileCols || tileY >= cache.tileRows) continue
        const tile = getTile(cache, tileX, tileY)
        const tileCol = tileX * cache.tileSize
        const tileRow = tileY * cache.tileSize
        ctx.drawImage(
          tile,
          offsetX + tileCol * cellPx,
          offsetY + tileRow * cellPx,
          tile.width * cellPx,
          tile.height * cellPx,
        )
      }
    }

    if (cellPx >= 4) {
      let step = 1
      const visibleLineCount = (maxCol - minCol) + (maxTopRow - minTopRow)
      if (visibleLineCount > 1200) step = Math.ceil(visibleLineCount / 1200)
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.18)'
      ctx.lineWidth = 1
      const firstCol = Math.floor(minCol / step) * step
      const firstRow = Math.floor(minTopRow / step) * step
      for (let col = firstCol; col <= maxCol; col += step) {
        if (col < minCol || col > mapWidth) continue
        const x = offsetX + col * cellPx
        ctx.moveTo(x, offsetY + minTopRow * cellPx)
        ctx.lineTo(x, offsetY + maxTopRow * cellPx)
      }
      for (let row = firstRow; row <= maxTopRow; row += step) {
        if (row < minTopRow || row > mapHeight) continue
        const y = offsetY + row * cellPx
        ctx.moveTo(offsetX + minCol * cellPx, y)
        ctx.lineTo(offsetX + maxCol * cellPx, y)
      }
      ctx.stroke()
    }

    if (hoverCell && cellPx >= 2) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.22)'
      ctx.fillRect(
        hoverCell.col * cellPx + offsetX + 0.5,
        hoverCell.row * cellPx + offsetY + 0.5,
        Math.max(0.5, cellPx - 1),
        Math.max(0.5, cellPx - 1),
      )
    }

    if (highlightedCells.size > 0 && cellPx >= 1) {
      ctx.shadowColor = 'rgba(217, 119, 6, 0.5)'
      ctx.shadowBlur = Math.min(8, cellPx * 0.4)
      ctx.fillStyle = 'rgba(217, 119, 6, 0.45)'
      ctx.strokeStyle = 'rgba(180, 83, 9, 0.85)'
      ctx.lineWidth = Math.max(1, cellPx * 0.08)
      for (const key of highlightedCells) {
        const parts = key.split(',')
        const row = parseInt(parts[0])
        const col = parseInt(parts[1])
        if (row < minTopRow || row > maxTopRow || col < minCol || col > maxCol) continue
        const cx = col * cellPx + offsetX
        const cy = row * cellPx + offsetY
        ctx.fillRect(cx, cy, Math.max(1, cellPx), Math.max(1, cellPx))
        if (cellPx >= 4) {
          ctx.strokeRect(cx, cy, Math.max(1, cellPx), Math.max(1, cellPx))
        }
      }
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }
  }

  function downloadFiles() {
    if (!grid.value) return
    const pgmData = serializePgmBinary(grid.value)
    const yamlText = serializeMapYaml(grid.value)
    const pgmBlob = new Blob([pgmData], { type: 'application/octet-stream' })
    const yamlBlob = new Blob([yamlText], { type: 'text/yaml' })
    const pgmUrl = URL.createObjectURL(pgmBlob)
    const yamlUrl = URL.createObjectURL(yamlBlob)
    const linkPgm = document.createElement('a')
    linkPgm.href = pgmUrl
    linkPgm.download = 'map.pgm'
    document.body.appendChild(linkPgm)
    linkPgm.click()
    document.body.removeChild(linkPgm)
    URL.revokeObjectURL(pgmUrl)
    const linkYaml = document.createElement('a')
    linkYaml.href = yamlUrl
    linkYaml.download = 'map.yaml'
    document.body.appendChild(linkYaml)
    linkYaml.click()
    document.body.removeChild(linkYaml)
    URL.revokeObjectURL(yamlUrl)
  }

  function dispose() {
    tileCache = null
    grid.value = null
    hoverCell = null
    const canvas = params.gridCanvasRef.value
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  function countCellsInStrokes(strokes: Array<{ x: number; y: number }>): number {
    if (!grid.value) return 0
    const map = grid.value
    const counted = new Set<string>()
    let count = 0
    for (const stroke of strokes) {
      const cell = worldToGridCell(map, stroke.x, stroke.y)
      if (!cell) continue
      const key = `${cell.row},${cell.col}`
      if (counted.has(key)) continue
      counted.add(key)
      const index = cell.row * map.image.width + cell.col
      if (map.image.data[index] !== FREE_GRAY) {
        count++
      }
    }
    return count
  }

  function getSerializedFiles(_mapName: string): { pgmBlob: Blob; yamlText: string } | null {
    if (!grid.value) return null
    const pgmData = serializePgmBinary(grid.value)
    const yamlText = serializeMapYaml(grid.value)
    const pgmBlob = new Blob([pgmData], { type: 'application/octet-stream' })
    return { pgmBlob, yamlText }
  }

  return {
    grid,
    showGrid,
    generating,
    obstacleConfig,
    generateFromPoints,
    showGridDisplay() { showGrid.value = true; scheduleRender() },
    hideGridDisplay() { showGrid.value = false; scheduleRender() },
    invalidateCache,
    paintDisk,
    eraseByRect,
    countCellsInStrokes,
    drawGrid,
    downloadFiles,
    dispose,
    getSerializedFiles,
  }
}
