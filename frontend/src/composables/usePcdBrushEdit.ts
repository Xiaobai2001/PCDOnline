import { ref, type Ref } from 'vue'
import * as THREE from 'three'
import { type PcdMap, type PcdPoint, serializePcdAscii } from '@/utils/pcd'

export type ToolMode = 'add' | 'erase' | 'erase-rect' | 'move' | 'grid-occupy' | 'grid-free' | 'grid-free-rect'

type SpatialIndex = Map<number, Map<number, number[]>>

export function usePcdBrushEdit(params: {
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.OrthographicCamera | null
  render: () => void
  updateCameraView: () => void
  container: Ref<HTMLElement | undefined>
  onEdit: () => void
}) {
  const toolMode = ref<ToolMode>('move')
  const brushRadius = ref(0.5)
  const addPointZ = ref(0)
  const pointSize = ref(3)
  const pcdMap = ref<PcdMap | null>(null)
  const activeCount = ref(0)

  let basePositions: Float32Array | null = null
  let deletedMask: Uint8Array | null = null
  let highlightedMask: Uint8Array | null = null
  let addedPoints: PcdPoint[] = []
  let deletedAddedMask: Uint8Array = new Uint8Array()
  let highlightedAddedMask: Uint8Array = new Uint8Array()
  let pointCloud: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
  let addedPointCloud: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
  let pointMaterial: THREE.ShaderMaterial | null = null
  let addedPointMaterial: THREE.ShaderMaterial | null = null
  let spatialIndex: SpatialIndex = new Map()
  const SPATIAL_RESOLUTION = 0.5

  const vertexShader = `
    uniform float uSize;
    attribute float deleted;
    attribute float highlighted;
    varying float vDeleted;
    varying float vHighlighted;
    void main() {
      vDeleted = deleted;
      vHighlighted = highlighted;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = uSize;
    }
  `
  const fragmentShader = `
    uniform vec3 uColor;
    uniform vec3 uHighlightColor;
    varying float vDeleted;
    varying float vHighlighted;
    void main() {
      if (vDeleted > 0.5) discard;
      if (vHighlighted > 0.5) {
        gl_FragColor = vec4(uHighlightColor, 1.0);
      } else {
        gl_FragColor = vec4(uColor, 1.0);
      }
    }
  `

  function buildSpatialIndex(positions: Float32Array) {
    spatialIndex.clear()
    if (!positions) return
    for (let i = 0; i < positions.length; i += 3) {
      const gx = Math.floor(positions[i] / SPATIAL_RESOLUTION)
      const gy = Math.floor(positions[i + 1] / SPATIAL_RESOLUTION)
      let col = spatialIndex.get(gx)
      if (!col) { col = new Map(); spatialIndex.set(gx, col) }
      let cell = col.get(gy)
      if (!cell) { cell = []; col.set(gy, cell) }
      cell.push(i / 3)
    }
  }

  function initPointCloud(map: PcdMap) {
    const scene = params.getScene()
    if (!scene) {
      console.warn('[brushEdit] initPointCloud: scene is null!')
      return
    }

    console.log('[brushEdit] initPointCloud: scene exists, points:', map.points.length)
    disposePointCloud()

    pcdMap.value = map
    const points = map.points
    basePositions = new Float32Array(points.length * 3)
    deletedMask = new Uint8Array(points.length)
    highlightedMask = new Uint8Array(points.length)
    addedPoints = []
    deletedAddedMask = new Uint8Array()
    highlightedAddedMask = new Uint8Array()

    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      basePositions[i * 3] = p.x
      basePositions[i * 3 + 1] = p.y
      basePositions[i * 3 + 2] = p.z
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(basePositions, 3))
    geometry.setAttribute('deleted', new THREE.BufferAttribute(deletedMask, 1))
    geometry.setAttribute('highlighted', new THREE.BufferAttribute(highlightedMask!, 1))
    geometry.computeBoundingSphere()

    pointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x2563EB) },
        uHighlightColor: { value: new THREE.Color(0xD97706) },
        uSize: { value: pointSize.value },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    })

    pointCloud = new THREE.Points(geometry, pointMaterial)
    pointCloud.renderOrder = 20
    pointCloud.position.z = 2
    scene.add(pointCloud)

    const addedVertexShader = `
      uniform float uSize;
      attribute float highlighted;
      varying float vHighlighted;
      void main() {
        vHighlighted = highlighted;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize;
      }
    `
    const addedFragmentShader = `
      uniform vec3 uColor;
      uniform vec3 uHighlightColor;
      varying float vHighlighted;
      void main() {
        if (vHighlighted > 0.5) {
          gl_FragColor = vec4(uHighlightColor, 1.0);
        } else {
          gl_FragColor = vec4(uColor, 1.0);
        }
      }
    `
    addedPointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x2563EB) },
        uHighlightColor: { value: new THREE.Color(0xD97706) },
        uSize: { value: pointSize.value },
      },
      vertexShader: addedVertexShader,
      fragmentShader: addedFragmentShader,
      depthTest: false,
      depthWrite: false,
    })

    buildSpatialIndex(basePositions)
    updateActiveCount()
    params.render()
  }

  function rebuildAddedPointCloud() {
    const scene = params.getScene()
    if (!scene) return

    // 如果还没有 addedPointMaterial，创建它
    if (!addedPointMaterial) {
      const addedVertexShader = `
        uniform float uSize;
        attribute float highlighted;
        varying float vHighlighted;
        void main() {
          vHighlighted = highlighted;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize;
        }
      `
      const addedFragmentShader = `
        uniform vec3 uColor;
        uniform vec3 uHighlightColor;
        varying float vHighlighted;
        void main() {
          if (vHighlighted > 0.5) {
            gl_FragColor = vec4(uHighlightColor, 1.0);
          } else {
            gl_FragColor = vec4(uColor, 1.0);
          }
        }
      `
      addedPointMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0x2563EB) },
          uHighlightColor: { value: new THREE.Color(0xD97706) },
          uSize: { value: pointSize.value },
        },
        vertexShader: addedVertexShader,
        fragmentShader: addedFragmentShader,
        depthTest: false,
        depthWrite: false,
      })
    }

    if (addedPointCloud) {
      scene.remove(addedPointCloud)
      addedPointCloud.geometry.dispose()
      addedPointCloud = null
    }

    let activeCount = 0
    for (let i = 0; i < addedPoints.length; i++) {
      if (!deletedAddedMask[i]) activeCount++
    }
    if (!activeCount) return

    const positions = new Float32Array(activeCount * 3)
    const highlightedArr = new Uint8Array(activeCount)
    let cursor = 0
    for (let i = 0; i < addedPoints.length; i++) {
      if (deletedAddedMask[i]) continue
      const p = addedPoints[i]
      positions[cursor * 3] = p.x
      positions[cursor * 3 + 1] = p.y
      positions[cursor * 3 + 2] = p.z
      highlightedArr[cursor] = highlightedAddedMask[i] || 0
      cursor++
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('highlighted', new THREE.BufferAttribute(highlightedArr, 1))
    geometry.computeBoundingSphere()
    addedPointCloud = new THREE.Points(geometry, addedPointMaterial)
    addedPointCloud.renderOrder = 30
    addedPointCloud.position.z = 3
    scene.add(addedPointCloud)
  }

  function eraseByBrush(cx: number, cy: number, radius: number): number {
    const radius2 = radius * radius
    let changed = false

    // 擦除原始点云中的点（需要 deletedMask 和 pcdMap）
    if (deletedMask && pcdMap.value) {
      const gxMin = Math.floor((cx - radius) / SPATIAL_RESOLUTION)
      const gxMax = Math.floor((cx + radius) / SPATIAL_RESOLUTION)
      const gyMin = Math.floor((cy - radius) / SPATIAL_RESOLUTION)
      const gyMax = Math.floor((cy + radius) / SPATIAL_RESOLUTION)

      for (let gx = gxMin; gx <= gxMax; gx++) {
        const col = spatialIndex.get(gx)
        if (!col) continue
        for (let gy = gyMin; gy <= gyMax; gy++) {
          const cell = col.get(gy)
          if (!cell) continue
          for (const idx of cell) {
            if (deletedMask[idx]) continue
            const px = basePositions![idx * 3]
            const py = basePositions![idx * 3 + 1]
            const dx = px - cx
            const dy = py - cy
            if (dx * dx + dy * dy <= radius2) {
              deletedMask[idx] = 1
              changed = true
            }
          }
        }
      }
    }

    let addedErased = 0
    for (let i = 0; i < addedPoints.length; i++) {
      if (deletedAddedMask[i]) continue
      const dx = addedPoints[i].x - cx
      const dy = addedPoints[i].y - cy
      if (dx * dx + dy * dy <= radius2) {
        deletedAddedMask[i] = 1
        addedErased++
        changed = true
      }
    }

    if (changed) {
      const attr = pointCloud?.geometry.getAttribute('deleted') as THREE.BufferAttribute
      if (attr) attr.needsUpdate = true
      if (addedErased > 0) rebuildAddedPointCloud()
      updateActiveCount()
      params.onEdit()
      params.render()
    }
    return changed ? 1 : 0
  }

  function addPointByBrush(cx: number, cy: number, z: number, spacing: number) {
    const count = Math.max(1, Math.ceil((brushRadius.value * 2) / spacing))
    const half = brushRadius.value
    let added = false
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        const px = cx - half + (i + 0.5) * (half * 2 / count)
        const py = cy - half + (j + 0.5) * (half * 2 / count)
        const dx = px - cx
        const dy = py - cy
        if (dx * dx + dy * dy > half * half) continue
        addedPoints.push({ x: px, y: py, z, values: { x: px, y: py, z } })
        added = true
      }
    }
    if (added) {
      const newDeleted = new Uint8Array(addedPoints.length)
      newDeleted.set(deletedAddedMask.subarray(0, Math.min(deletedAddedMask.length, newDeleted.length)))
      deletedAddedMask = newDeleted
      const newHighlighted = new Uint8Array(addedPoints.length)
      newHighlighted.set(highlightedAddedMask.subarray(0, Math.min(highlightedAddedMask.length, newHighlighted.length)))
      highlightedAddedMask = newHighlighted
      rebuildAddedPointCloud()
      updateActiveCount()
      params.onEdit()
      params.render()
    }
  }

  function clearAllPoints() {
    if (!deletedMask || !pcdMap.value) return
    deletedMask.fill(1)
    deletedAddedMask = new Uint8Array(addedPoints.length).fill(1)
    const attr = pointCloud?.geometry.getAttribute('deleted') as THREE.BufferAttribute
    if (attr) attr.needsUpdate = true
    rebuildAddedPointCloud()
    updateActiveCount()
    params.onEdit()
    params.render()
  }

  function eraseByRect(minX: number, minY: number, maxX: number, maxY: number): { baseErased: number; addedErased: number } {
    let baseErased = 0
    let addedErased = 0

    // 擦除原始点云中的点
    if (deletedMask && pcdMap.value) {
      for (let i = 0; i < deletedMask.length; i++) {
        if (deletedMask[i]) continue
        const px = basePositions![i * 3]
        const py = basePositions![i * 3 + 1]
        if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
          deletedMask[i] = 1
          baseErased++
        }
      }
    }

    for (let i = 0; i < addedPoints.length; i++) {
      if (deletedAddedMask[i]) continue
      const px = addedPoints[i].x
      const py = addedPoints[i].y
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
        deletedAddedMask[i] = 1
        addedErased++
      }
    }

    const changed = baseErased > 0 || addedErased > 0
    if (changed) {
      const attr = pointCloud?.geometry.getAttribute('deleted') as THREE.BufferAttribute
      if (attr) attr.needsUpdate = true
      if (addedErased > 0) rebuildAddedPointCloud()
      updateActiveCount()
      params.onEdit()
      params.render()
    }
    return { baseErased, addedErased }
  }

  function addSinglePoint(x: number, y: number, z: number) {
    // 允许在没有加载文件的情况下添加点
    if (!pcdMap.value) {
      // 创建一个虚拟的空 pcdMap 以支持添加点功能
      pcdMap.value = {
        header: {
          version: '0.7',
          fields: ['x', 'y', 'z'],
          size: [4, 4, 4],
          type: ['F', 'F', 'F'],
          count: [1, 1, 1],
          width: 0,
          height: 1,
          viewpoint: '0 0 0 1 0 0 0',
          points: 0,
          comments: ['# new_map']
        },
        points: []
      }
      basePositions = new Float32Array(0)
      deletedMask = new Uint8Array(0)
      highlightedMask = new Uint8Array(0)
    }
    
    addedPoints.push({ x, y, z, values: { x, y, z } })
    const newDeleted = new Uint8Array(deletedAddedMask.length + 1)
    newDeleted.set(deletedAddedMask)
    deletedAddedMask = newDeleted
    rebuildAddedPointCloud()
    updateActiveCount()
    params.onEdit()
    params.render()
  }

  function updateActiveCount() {
    let count = 0
    // 计算原始点云中的活跃点
    if (deletedMask && pcdMap.value) {
      for (let i = 0; i < deletedMask.length; i++) {
        if (!deletedMask[i]) count++
      }
    }
    // 计算新添加的活跃点
    for (let i = 0; i < addedPoints.length; i++) {
      if (!deletedAddedMask[i]) count++
    }
    activeCount.value = count
  }

  function getActivePoints(): PcdPoint[] {
    const result: PcdPoint[] = []
    if (!pcdMap.value) return result
    for (let i = 0; i < pcdMap.value.points.length; i++) {
      if (!deletedMask?.[i]) result.push(pcdMap.value.points[i])
    }
    for (let i = 0; i < addedPoints.length; i++) {
      if (!deletedAddedMask[i]) result.push(addedPoints[i])
    }
    return result
  }

  function downloadAsciiPcd() {
    const points = getActivePoints()
    if (!points.length || !pcdMap.value) return
    const exportMap: PcdMap = {
      header: { ...pcdMap.value.header, points: points.length, width: points.length, height: 1 },
      points,
    }
    const text = serializePcdAscii(exportMap)
    const blob = new Blob([text], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = (pcdMap.value.header.comments[0]?.replace(/^#\s*/, '') || 'map') + '.pcd'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function getActivePointsXY(): Array<{ x: number; y: number }> {
    return getActivePoints().map((p) => ({ x: p.x, y: p.y }))
  }

  function disposePointCloud() {
    const scene = params.getScene()
    if (!scene) return
    if (pointCloud) {
      scene.remove(pointCloud)
      pointCloud.geometry.dispose()
      pointCloud = null
    }
    if (addedPointCloud) {
      scene.remove(addedPointCloud)
      addedPointCloud.geometry.dispose()
      addedPointCloud = null
    }
    if (pointMaterial) {
      pointMaterial.dispose()
      pointMaterial = null
    }
    if (addedPointMaterial) {
      addedPointMaterial.dispose()
      addedPointMaterial = null
    }
    basePositions = null
    deletedMask = null
    highlightedMask = null
    addedPoints = []
    deletedAddedMask = new Uint8Array()
    highlightedAddedMask = new Uint8Array()
    spatialIndex.clear()
    pcdMap.value = null
    activeCount.value = 0
  }

  function fitToView() {
    const scene = params.getScene()
    if (!scene || !pcdMap.value) return
    const points = pcdMap.value.points
    if (!points.length) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of points) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
    const camera = params.getCamera()
    if (!camera) return
    const padding = 1.2
    const rangeX = (maxX - minX) * padding
    const rangeY = (maxY - minY) * padding
    camera.position.set((minX + maxX) / 2, (minY + maxY) / 2, camera.position.z)
    const container = params.container.value
    if (container) {
      const aspect = container.clientWidth / container.clientHeight
      const viewSize = Math.max(rangeX / aspect, rangeY)
      camera.left = -viewSize * aspect / 2
      camera.right = viewSize * aspect / 2
      camera.top = viewSize / 2
      camera.bottom = -viewSize / 2
      camera.updateProjectionMatrix()
    }
    params.render()
  }

  function exportToString(): string {
    const points = getActivePoints()
    if (!pcdMap.value) {
      // 无原始点云时创建一个新的
      const header = {
        version: '0.7',
        fields: ['x', 'y', 'z'],
        size: [4, 4, 4],
        type: ['F', 'F', 'F'],
        count: [1, 1, 1],
        width: points.length,
        height: 1,
        viewpoint: '0 0 0 1 0 0 0',
        points: points.length,
        comments: ['# edited_map']
      }
      return serializePcdAscii({ header, points })
    }
    const exportMap: PcdMap = {
      header: { ...pcdMap.value.header, points: points.length, width: points.length, height: 1 },
      points,
    }
    return serializePcdAscii(exportMap)
  }

  function clearAll() {
    disposePointCloud()
    pcdMap.value = null
    basePositions = new Float32Array(0)
    deletedMask = new Uint8Array(0)
    highlightedMask = new Uint8Array(0)
    addedPoints = []
    deletedAddedMask = new Uint8Array()
    highlightedAddedMask = new Uint8Array()
    updateActiveCount()
    params.render()
  }

  return {
    toolMode,
    brushRadius,
    addPointZ,
    pointSize,
    pcdMap,
    activeCount,
    initPointCloud,
    eraseByBrush,
    addPointByBrush,
    addSinglePoint,
    eraseByRect,
    clearAllPoints,
    getActivePoints,
    getActivePointsXY,
    downloadAsciiPcd,
    exportToString,
    clearAll,
    disposePointCloud,
    fitToView,
    rebuildAddedPointCloud,
  }
}
