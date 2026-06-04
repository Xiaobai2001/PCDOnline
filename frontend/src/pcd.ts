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

function parseHeader(text: string): { header: PcdHeader; dataStartLine: number } {
  const lines = text.split('\n')
  const header: Partial<PcdHeader> = { comments: [] }
  let dataStartLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) {
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

function parseAsciiData(lines: string[], startLine: number, header: PcdHeader): PcdPoint[] {
  const fieldMap = new Map<string, number>()
  header.fields.forEach((field, index) => fieldMap.set(field, index))
  const points: PcdPoint[] = []

  for (let i = startLine; i < lines.length && points.length < header.points; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const tokens = line.split(/\s+/)
    const values: Record<string, number> = {}
    for (let j = 0; j < header.fields.length && j < tokens.length; j++) {
      values[header.fields[j]] = parseFloat(tokens[j])
    }
    points.push({
      x: fieldMap.has('x') ? values.x || 0 : 0,
      y: fieldMap.has('y') ? values.y || 0 : 0,
      z: fieldMap.has('z') ? values.z || 0 : 0,
      values
    })
  }

  return points
}

function readScalar(view: DataView, offset: number, type: string, size: number) {
  if (type === 'F') {
    if (size === 4) return view.getFloat32(offset, true)
    if (size === 8) return view.getFloat64(offset, true)
  }
  if (type === 'U') {
    if (size === 1) return view.getUint8(offset)
    if (size === 2) return view.getUint16(offset, true)
    if (size === 4) return view.getUint32(offset, true)
  }
  if (type === 'I') {
    if (size === 1) return view.getInt8(offset)
    if (size === 2) return view.getInt16(offset, true)
    if (size === 4) return view.getInt32(offset, true)
  }
  return 0
}

function parseBinaryData(buffer: ArrayBuffer, header: PcdHeader): PcdPoint[] {
  const view = new DataView(buffer)
  const points: PcdPoint[] = []
  const fieldOffsets: number[] = []
  let pointSize = 0
  for (let i = 0; i < header.fields.length; i++) {
    fieldOffsets.push(pointSize)
    pointSize += header.size[i] * header.count[i]
  }

  for (let p = 0; p < header.points; p++) {
    const base = p * pointSize
    const values: Record<string, number> = {}
    for (let f = 0; f < header.fields.length; f++) {
      values[header.fields[f]] = readScalar(view, base + fieldOffsets[f], header.type[f], header.size[f])
    }
    points.push({ x: values.x || 0, y: values.y || 0, z: values.z || 0, values })
  }
  return points
}

function decompressLzf(compressed: Uint8Array, expectedSize: number): ArrayBuffer {
  const output = new Uint8Array(expectedSize)
  let inputIndex = 0
  let outputIndex = 0

  while (inputIndex < compressed.length && outputIndex < expectedSize) {
    const ctrl = compressed[inputIndex++]
    if (ctrl < 32) {
      const length = ctrl + 1
      for (let i = 0; i < length && outputIndex < expectedSize; i++) {
        output[outputIndex++] = compressed[inputIndex++]
      }
    } else {
      let length = ctrl >> 5
      let reference = outputIndex - ((ctrl & 0x1f) << 8) - 1
      if (length === 7) length += compressed[inputIndex++]
      reference -= compressed[inputIndex++]
      length += 2
      for (let i = 0; i < length && outputIndex < expectedSize; i++) {
        output[outputIndex++] = output[reference + i]
      }
    }
  }

  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength)
}

function parseBinaryCompressedData(buffer: ArrayBuffer, header: PcdHeader): PcdPoint[] {
  const view = new DataView(buffer)
  if (buffer.byteLength < 8) return []

  const compressedSize = view.getUint32(0, true)
  const uncompressedSize = view.getUint32(4, true)
  const compressed = new Uint8Array(buffer, 8, compressedSize)
  const decompressed = decompressLzf(compressed, uncompressedSize)

  const fieldSizes = header.fields.map((_, index) => header.size[index] * header.count[index])
  const fieldOffsets: number[] = []
  let offset = 0
  for (const size of fieldSizes) {
    fieldOffsets.push(offset)
    offset += size * header.points
  }

  const decompressedView = new DataView(decompressed)
  const points: PcdPoint[] = []
  for (let pointIndex = 0; pointIndex < header.points; pointIndex++) {
    const values: Record<string, number> = {}
    for (let fieldIndex = 0; fieldIndex < header.fields.length; fieldIndex++) {
      const fieldOffset = fieldOffsets[fieldIndex] + pointIndex * header.size[fieldIndex]
      values[header.fields[fieldIndex]] = readScalar(decompressedView, fieldOffset, header.type[fieldIndex], header.size[fieldIndex])
    }
    points.push({ x: values.x || 0, y: values.y || 0, z: values.z || 0, values })
  }
  return points
}

export async function parsePcdFile(file: File): Promise<PcdMap> {
  const buffer = await file.arrayBuffer()
  const text = new TextDecoder().decode(buffer)
  const { header, dataStartLine } = parseHeader(text)

  let points: PcdPoint[]
  if (header.dataType === 'ascii') {
    points = parseAsciiData(text.split('\n'), dataStartLine, header)
  } else {
    const dataIndex = text.indexOf('DATA')
    const headerEnd = dataIndex + text.substring(dataIndex).indexOf('\n') + 1
    const dataBuffer = buffer.slice(new TextEncoder().encode(text.substring(0, headerEnd)).length)
    if (header.dataType === 'binary') {
      points = parseBinaryData(dataBuffer, header)
    } else {
      points = parseBinaryCompressedData(dataBuffer, header)
    }
  }

  header.points = points.length
  header.width = points.length
  return { header, points }
}

export function serializePcdAscii(map: PcdMap): string {
  const h = { ...map.header, dataType: 'ascii' as const, points: map.points.length, width: map.points.length, height: 1 }
  const lines: string[] = []
  lines.push(...h.comments)
  lines.push(`VERSION ${h.version}`)
  lines.push(`FIELDS ${h.fields.join(' ')}`)
  lines.push(`SIZE ${h.size.join(' ')}`)
  lines.push(`TYPE ${h.type.join(' ')}`)
  lines.push(`COUNT ${h.count.join(' ')}`)
  lines.push(`WIDTH ${h.width}`)
  lines.push(`HEIGHT ${h.height}`)
  lines.push(`VIEWPOINT ${h.viewpoint.join(' ')}`)
  lines.push(`POINTS ${h.points}`)
  lines.push('DATA ascii')
  for (const point of map.points) {
    lines.push(h.fields.map(field => String(point.values[field] ?? 0)).join(' '))
  }
  return lines.join('\n')
}
