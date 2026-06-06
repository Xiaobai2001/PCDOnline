export interface PcdPoint {
  x: number
  y: number
  z: number
  values: Record<string, number>
}

export interface PcdHeader {
  version: string
  fields: string[]
  size: number[]
  type: string[]
  count: number[]
  width: number
  height: number
  viewpoint: number[]
  points: number
  dataType: 'ascii' | 'binary' | 'binary_compressed'
  comments: string[]
}

export interface PcdMap {
  header: PcdHeader
  points: PcdPoint[]
}

export interface PcdParseProgress {
  phase: 'read' | 'header' | 'parse' | 'done'
  progress: number
}

function parseHeader(text: string): { header: PcdHeader; dataStartLine: number } {
  const lines = text.split('\n')
  const header: Partial<PcdHeader> = {
    comments: [],
  }
  let dataStartLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) {
      if (line.startsWith('#') && !header.comments) header.comments = []
      if (line.startsWith('#')) header.comments!.push(line)
      continue
    }

    const spaceIdx = line.indexOf(' ')
    if (spaceIdx === -1) continue
    const key = line.substring(0, spaceIdx).toLowerCase()
    const value = line.substring(spaceIdx + 1).trim()

    switch (key) {
      case 'version': header.version = value; break
      case 'fields': header.fields = value.split(/\s+/); break
      case 'size': header.size = value.split(/\s+/).map(Number); break
      case 'type': header.type = value.split(/\s+/); break
      case 'count': header.count = value.split(/\s+/).map(Number); break
      case 'width': header.width = parseInt(value); break
      case 'height': header.height = parseInt(value); break
      case 'viewpoint': header.viewpoint = value.split(/\s+/).map(Number); break
      case 'points': header.points = parseInt(value); break
      case 'data': header.dataType = value as PcdHeader['dataType']; break
    }

    if (key === 'data') {
      dataStartLine = i + 1
      break
    }
  }

  return {
    header: {
      version: header.version || '0.7',
      fields: header.fields || ['x', 'y', 'z'],
      size: header.size || [4, 4, 4],
      type: header.type || ['F', 'F', 'F'],
      count: header.count || [1, 1, 1],
      width: header.width || 0,
      height: header.height || 1,
      viewpoint: header.viewpoint || [0, 0, 0, 1, 0, 0, 0],
      points: header.points || 0,
      dataType: header.dataType || 'ascii',
      comments: header.comments || [],
    },
    dataStartLine,
  }
}

function buildFieldIndexMap(fields: string[]): Map<string, number> {
  const map = new Map<string, number>()
  fields.forEach((f, i) => map.set(f, i))
  return map
}

function parseAsciiData(
  lines: string[],
  startLine: number,
  header: PcdHeader,
  onProgress?: (p: PcdParseProgress) => void
): PcdPoint[] {
  const fieldMap = buildFieldIndexMap(header.fields)
  const hasX = fieldMap.has('x')
  const hasY = fieldMap.has('y')
  const hasZ = fieldMap.has('z')
  const points: PcdPoint[] = []
  const totalLines = header.points

  for (let i = startLine; i < lines.length && points.length < totalLines; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const tokens = line.split(/\s+/)
    const values: Record<string, number> = {}
    for (let j = 0; j < header.fields.length && j < tokens.length; j++) {
      values[header.fields[j]] = parseFloat(tokens[j])
    }
    const x = hasX ? (values['x'] || 0) : 0
    const y = hasY ? (values['y'] || 0) : 0
    const z = hasZ ? (values['z'] || 0) : 0
    points.push({ x, y, z, values })
    if (onProgress && points.length % 50000 === 0) {
      onProgress({ phase: 'parse', progress: points.length / totalLines })
    }
  }

  return points
}

function parseBinaryData(
  buffer: ArrayBuffer,
  header: PcdHeader,
  onProgress?: (p: PcdParseProgress) => void
): PcdPoint[] {
  const view = new DataView(buffer)
  const totalPoints = header.points
  const points: PcdPoint[] = []

  let byteOffset = 0
  const fieldOffsets: number[] = []
  const fieldByteSizes: number[] = []
  for (let i = 0; i < header.fields.length; i++) {
    fieldOffsets.push(byteOffset)
    const sz = header.size[i] * header.count[i]
    fieldByteSizes.push(sz)
    byteOffset += sz
  }
  const pointSize = byteOffset

  const fieldMap = buildFieldIndexMap(header.fields)
  const xIdx = fieldMap.get('x')
  const yIdx = fieldMap.get('y')
  const zIdx = fieldMap.get('z')

  for (let p = 0; p < totalPoints; p++) {
    const base = p * pointSize
    const values: Record<string, number> = {}

    for (let f = 0; f < header.fields.length; f++) {
      const offset = base + fieldOffsets[f]
      const fieldType = header.type[f]
      const fieldSize = header.size[f]
      const cnt = header.count[f]

      if (cnt === 1) {
        values[header.fields[f]] = readScalar(view, offset, fieldType, fieldSize)
      } else {
        for (let c = 0; c < cnt; c++) {
          values[`${header.fields[f]}_${c}`] = readScalar(view, offset + c * fieldSize, fieldType, fieldSize)
        }
      }
    }

    const x = xIdx !== undefined ? (values['x'] || 0) : 0
    const y = yIdx !== undefined ? (values['y'] || 0) : 0
    const z = zIdx !== undefined ? (values['z'] || 0) : 0
    points.push({ x, y, z, values })

    if (onProgress && p % 50000 === 0) {
      onProgress({ phase: 'parse', progress: p / totalPoints })
    }
  }

  return points
}

function readScalar(view: DataView, offset: number, type: string, size: number): number {
  if (type === 'F') {
    if (size === 4) return view.getFloat32(offset, true)
    if (size === 8) return view.getFloat64(offset, true)
  } else if (type === 'U') {
    if (size === 1) return view.getUint8(offset)
    if (size === 2) return view.getUint16(offset, true)
    if (size === 4) return view.getUint32(offset, true)
  } else if (type === 'I') {
    if (size === 1) return view.getInt8(offset)
    if (size === 2) return view.getInt16(offset, true)
    if (size === 4) return view.getInt32(offset, true)
  }
  return 0
}

export async function parsePcdFile(
  file: File,
  onProgress?: (p: PcdParseProgress) => void
): Promise<PcdMap> {
  onProgress?.({ phase: 'read', progress: 0 })

  const buffer = await file.arrayBuffer()
  onProgress?.({ phase: 'read', progress: 1 })

  const text = new TextDecoder().decode(buffer)
  const { header, dataStartLine } = parseHeader(text)
  onProgress?.({ phase: 'header', progress: 0 })

  let points: PcdPoint[]

  if (header.dataType === 'ascii') {
    const lines = text.split('\n')
    points = parseAsciiData(lines, dataStartLine, header, onProgress)
  } else if (header.dataType === 'binary') {
    const headerText = text.substring(0, text.indexOf('DATA') + text.substring(text.indexOf('DATA')).indexOf('\n') + 1)
    const headerBytes = new TextEncoder().encode(headerText)
    const dataBuffer = buffer.slice(headerBytes.length)
    points = parseBinaryData(dataBuffer, header, onProgress)
  } else {
    const headerEnd = text.indexOf('DATA') + text.substring(text.indexOf('DATA')).indexOf('\n') + 1
    const headerBytes = new TextEncoder().encode(text.substring(0, headerEnd))
    const compressedData = new Uint8Array(buffer, headerBytes.length)
    const decompressed = decompressLzf(compressedData, header)
    points = parseBinaryData(decompressed, header, onProgress)
  }

  if (points.length !== header.points) {
    header.points = points.length
    header.width = points.length
  }

  onProgress?.({ phase: 'done', progress: 1 })
  return { header, points }
}

export async function parsePcdFromString(
  content: string,
  onProgress?: (p: PcdParseProgress) => void
): Promise<PcdMap> {
  onProgress?.({ phase: 'read', progress: 1 })

  const { header, dataStartLine } = parseHeader(content)
  onProgress?.({ phase: 'header', progress: 0 })

  let points: PcdPoint[]

  if (header.dataType === 'ascii') {
    const lines = content.split('\n')
    points = parseAsciiData(lines, dataStartLine, header, onProgress)
  } else {
    // Binary or compressed binary from string - convert to buffer
    const encoder = new TextEncoder()
    const buffer = encoder.encode(content).buffer
    if (header.dataType === 'binary') {
      const headerText = content.substring(0, content.indexOf('DATA') + content.substring(content.indexOf('DATA')).indexOf('\n') + 1)
      const headerBytes = encoder.encode(headerText)
      const dataBuffer = buffer.slice(headerBytes.byteOffset + headerBytes.byteLength)
      points = parseBinaryData(new Uint8Array(dataBuffer), header, onProgress)
    } else {
      const headerEnd = content.indexOf('DATA') + content.substring(content.indexOf('DATA')).indexOf('\n') + 1
      const headerBytes = encoder.encode(content.substring(0, headerEnd))
      const compressedData = new Uint8Array(buffer, headerBytes.byteLength)
      const decompressed = decompressLzf(compressedData, header)
      points = parseBinaryData(decompressed, header, onProgress)
    }
  }

  if (points.length !== header.points) {
    header.points = points.length
    header.width = points.length
  }

  onProgress?.({ phase: 'done', progress: 1 })
  return { header, points }
}

function decompressLzf(compressed: Uint8Array, header: PcdHeader): ArrayBuffer {
  const totalBytes = header.points * header.fields.reduce((sum, _, i) => sum + header.size[i] * header.count[i], 0)
  const output = new Uint8Array(totalBytes)
  let inIdx = 0
  let outIdx = 0

  while (inIdx < compressed.length && outIdx < totalBytes) {
    const ctrl = compressed[inIdx++]
    if (ctrl < 32) {
      const len = ctrl + 1
      for (let i = 0; i < len && outIdx < totalBytes; i++) {
        output[outIdx++] = compressed[inIdx++]
      }
    } else {
      let len = ctrl >> 5
      let ref = (ctrl & 31) << 8
      if (len === 7) len += compressed[inIdx++]
      ref += compressed[inIdx++]
      len += 2
      const offset = outIdx - ref - 1
      for (let i = 0; i < len && outIdx < totalBytes; i++) {
        output[outIdx++] = output[offset + i]
      }
    }
  }

  const result = output.slice(0, outIdx)
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength)
}

export function serializePcdAscii(map: PcdMap): string {
  const h = map.header
  const lines: string[] = []

  for (const c of h.comments) {
    lines.push(c)
  }
  lines.push(`VERSION ${h.version}`)
  lines.push(`FIELDS ${h.fields.join(' ')}`)
  lines.push(`SIZE ${h.size.join(' ')}`)
  lines.push(`TYPE ${h.type.join(' ')}`)
  lines.push(`COUNT ${h.count.join(' ')}`)
  lines.push(`WIDTH ${h.width}`)
  lines.push(`HEIGHT ${h.height}`)
  lines.push(`VIEWPOINT ${h.viewpoint.join(' ')}`)
  lines.push(`POINTS ${map.points.length}`)
  lines.push('DATA ascii')

  for (const p of map.points) {
    const tokens = h.fields.map(f => (p.values[f] ?? 0).toString())
    lines.push(tokens.join(' '))
  }

  return lines.join('\n')
}
