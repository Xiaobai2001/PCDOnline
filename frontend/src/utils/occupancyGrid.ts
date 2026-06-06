export interface PointXY {
  x: number
  y: number
}

export interface OccupancyGridMap {
  image: {
    width: number
    height: number
    data: Uint8Array
    maxValue: number
  }
  meta: {
    origin: number[]
    resolution: number
    negate: boolean
    occupiedThresh: number
    freeThresh: number
  }
}

export interface CreateObstacleGridOptions {
  resolution: number
  margin: number
  minCellPoints: number
}

export const FREE_GRAY = 254
export const OCCUPIED_GRAY = 0
const UNKNOWN_GRAY = 205

export function worldToGridCell(
  map: OccupancyGridMap,
  worldX: number,
  worldY: number
): { row: number; col: number } | null {
  const { origin, resolution } = map.meta
  const col = Math.floor((worldX - origin[0]) / resolution)
  const rowFromBottom = Math.floor((worldY - origin[1]) / resolution)
  const row = map.image.height - 1 - rowFromBottom
  if (col < 0 || col >= map.image.width || row < 0 || row >= map.image.height) {
    return null
  }
  return { row, col }
}

export function createObstacleGridFromPoints(
  points: PointXY[],
  options: CreateObstacleGridOptions
): OccupancyGridMap {
  const { resolution, margin, minCellPoints } = options

  if (!points || points.length === 0) {
    return {
      image: { width: 1, height: 1, data: new Uint8Array([UNKNOWN_GRAY]), maxValue: 255 },
      meta: { origin: [0, 0], resolution, negate: false, occupiedThresh: 0.65, freeThresh: 0.196 }
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }

  const marginWorld = margin * resolution
  minX -= marginWorld
  minY -= marginWorld
  maxX += marginWorld
  maxY += marginWorld

  const width = Math.ceil((maxX - minX) / resolution)
  const height = Math.ceil((maxY - minY) / resolution)

  const cellCount = new Uint16Array(width * height)
  for (const p of points) {
    const col = Math.floor((p.x - minX) / resolution)
    const rowFromBottom = Math.floor((p.y - minY) / resolution)
    if (col >= 0 && col < width && rowFromBottom >= 0 && rowFromBottom < height) {
      const row = height - 1 - rowFromBottom
      cellCount[row * width + col]++
    }
  }

  const data = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    data[i] = cellCount[i] >= minCellPoints ? OCCUPIED_GRAY : FREE_GRAY
  }

  return {
    image: { width, height, data, maxValue: 255 },
    meta: {
      origin: [minX, minY],
      resolution,
      negate: false,
      occupiedThresh: 0.65,
      freeThresh: 0.196,
    }
  }
}

export function paintOccupancyDisk(
  map: OccupancyGridMap,
  worldX: number,
  worldY: number,
  radius: number,
  occupied: boolean
): void {
  const { origin, resolution } = map.meta
  const gray = occupied ? OCCUPIED_GRAY : FREE_GRAY
  const centerCol = Math.floor((worldX - origin[0]) / resolution)
  const centerRowFB = Math.floor((worldY - origin[1]) / resolution)
  const radiusCells = Math.ceil(radius / resolution)

  for (let dy = -radiusCells; dy <= radiusCells; dy++) {
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      const col = centerCol + dx
      const rowFB = centerRowFB + dy
      if (col < 0 || col >= map.image.width || rowFB < 0 || rowFB >= map.image.height) continue
      const dist = Math.sqrt(dx * dx + dy * dy) * resolution
      if (dist > radius) continue
      const row = map.image.height - 1 - rowFB
      map.image.data[row * map.image.width + col] = gray
    }
  }
}

export function serializePgmBinary(map: OccupancyGridMap): ArrayBuffer {
  const { width, height, data, maxValue } = map.image
  const header = `P5\n${width} ${height}\n${maxValue}\n`
  const headerBytes = new TextEncoder().encode(header)
  const result = new Uint8Array(headerBytes.length + data.length)
  result.set(headerBytes, 0)
  result.set(data, headerBytes.length)
  return result.buffer
}

export function serializeMapYaml(map: OccupancyGridMap): string {
  const { meta } = map
  return [
    `image: map.pgm`,
    `resolution: ${meta.resolution}`,
    `origin: [${meta.origin[0]}, ${meta.origin[1]}, 0]`,
    `negate: ${meta.negate ? 1 : 0}`,
    `occupied_thresh: ${meta.occupiedThresh}`,
    `free_thresh: ${meta.freeThresh}`,
  ].join('\n')
}

export async function parseOccupancyGridFiles(
  pgmFile: File,
  yamlFile: File
): Promise<OccupancyGridMap> {
  const yamlText = await yamlFile.text()
  const meta = parseMapYaml(yamlText)

  const pgmBuffer = await pgmFile.arrayBuffer()
  const pgmBytes = new Uint8Array(pgmBuffer)

  const { width, height, maxValue, dataOffset } = parsePgmHeader(pgmBytes)
  const data = pgmBytes.slice(dataOffset, dataOffset + width * height)

  if (meta.negate) {
    for (let i = 0; i < data.length; i++) {
      data[i] = maxValue - data[i]
    }
  }

  return {
    image: { width, height, data, maxValue },
    meta,
  }
}

function parseMapYaml(text: string): OccupancyGridMap['meta'] {
  const resolution = parseFloat(extractYamlValue(text, 'resolution')) || 0.05
  const originStr = extractYamlValue(text, 'origin')
  const originMatch = originStr.match(/\[([^\]]+)\]/)
  const origin = originMatch
    ? originMatch[1].split(',').map(s => parseFloat(s.trim()))
    : [0, 0]
  const negate = parseInt(extractYamlValue(text, 'negate')) === 1
  const occupiedThresh = parseFloat(extractYamlValue(text, 'occupied_thresh')) || 0.65
  const freeThresh = parseFloat(extractYamlValue(text, 'free_thresh')) || 0.196

  return { origin, resolution, negate, occupiedThresh, freeThresh }
}

function extractYamlValue(text: string, key: string): string {
  const regex = new RegExp(key + '\\s*:\\s*(.+)')
  const match = text.match(regex)
  return match ? match[1].trim() : ''
}

function parsePgmHeader(bytes: Uint8Array): {
  width: number
  height: number
  maxValue: number
  dataOffset: number
} {
  let offset = 0
  const readToken = (): string => {
    while (offset < bytes.length && (bytes[offset] === 0x20 || bytes[offset] === 0x0a || bytes[offset] === 0x0d || bytes[offset] === 0x09)) {
      offset++
    }
    if (offset < bytes.length && bytes[offset] === 0x23) {
      while (offset < bytes.length && bytes[offset] !== 0x0a) offset++
      offset++
      return readToken()
    }
    const start = offset
    while (offset < bytes.length && bytes[offset] !== 0x20 && bytes[offset] !== 0x0a && bytes[offset] !== 0x0d && bytes[offset] !== 0x09) {
      offset++
    }
    return new TextDecoder().decode(bytes.slice(start, offset))
  }

  const magic = readToken()
  if (magic !== 'P5') {
    throw new Error('Unsupported PGM format: ' + magic + ', only P5 (binary) is supported')
  }
  const width = parseInt(readToken())
  const height = parseInt(readToken())
  const maxValue = parseInt(readToken())
  offset++

  return { width, height, maxValue, dataOffset: offset }
}
