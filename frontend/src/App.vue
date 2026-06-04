<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <h1>PCD 在线编辑器</h1>
        <p>一个页面完成上传、查看、编辑、保存修改、删除</p>
      </div>
      <div class="actions">
        <el-upload :show-file-list="false" accept=".pcd" :http-request="uploadPcd">
          <el-button type="primary">上传 PCD</el-button>
        </el-upload>
        <el-button @click="loadList">刷新</el-button>
        <el-button :disabled="!currentName || !dirty" type="success" @click="saveCurrent">保存修改</el-button>
        <el-button :disabled="!currentName" type="warning" @click="downloadCurrent">下载</el-button>
        <el-button :disabled="!currentName" type="danger" @click="deleteCurrent">删除</el-button>
      </div>
    </header>

    <section class="workspace">
      <aside class="file-panel">
        <div class="panel-title">PCD 文件</div>
        <div v-if="files.length === 0" class="empty">暂无文件，请先上传</div>
        <button
          v-for="file in files"
          :key="file.name"
          class="file-item"
          :class="{ active: currentName === file.name }"
          @click="openFile(file.name)"
        >
          <span class="name">{{ file.name }}</span>
          <span class="meta">{{ formatSize(file.size) }} · {{ formatTime(file.updateTime) }}</span>
        </button>
      </aside>

      <main class="editor-panel">
        <div class="canvas-toolbar">
          <el-radio-group v-model="toolMode" size="small">
            <el-radio-button label="move">移动</el-radio-button>
            <el-radio-button label="add">添加点</el-radio-button>
            <el-radio-button label="erase">橡皮擦</el-radio-button>
            <el-radio-button label="rect">框删</el-radio-button>
          </el-radio-group>
          <span>点大小</span>
          <el-slider v-model="pointSize" :min="1" :max="10" style="width: 120px" @change="updatePointSize" />
          <span>刷子</span>
          <el-slider v-model="brushRadius" :min="0.05" :max="3" :step="0.05" style="width: 140px" />
          <span>Z</span>
          <el-input-number v-model="addPointZ" :step="0.1" size="small" style="width: 110px" />
          <el-button size="small" @click="fitToView">适配视图</el-button>
          <el-button size="small" type="danger" @click="clearAllPoints">清空点</el-button>
          <span class="stat">点数：{{ activeCount }}</span>
          <span v-if="dirty" class="dirty">有未保存修改</span>
        </div>
        <div ref="canvasContainer" class="canvas-container"></div>
      </main>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import * as THREE from 'three'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { parsePcdFile, serializePcdAscii, type PcdMap, type PcdPoint } from './pcd'

interface PcdFileItem {
  name: string
  size: number
  updateTime: string
}

const files = ref<PcdFileItem[]>([])
const currentName = ref('')
const dirty = ref(false)
const activeCount = ref(0)
const toolMode = ref<'move' | 'add' | 'erase' | 'rect'>('move')
const brushRadius = ref(0.5)
const addPointZ = ref(0)
const pointSize = ref(3)
const canvasContainer = ref<HTMLElement>()

let scene: THREE.Scene | null = null
let camera: THREE.OrthographicCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let pointCloud: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null
let pcdMap: PcdMap | null = null
let deletedMask: Uint8Array | null = null
let addedPoints: PcdPoint[] = []
let isPanning = false
let isDragging = false
let rectStart: { x: number; y: number } | null = null
let lastMouse = { x: 0, y: 0 }
let zoom = 1

async function loadList() {
  const res = await axios.get('/api/pcd')
  files.value = res.data
}

async function uploadPcd(option: any) {
  try {
    const file = option.file as File
    const localMap = await parsePcdFile(file)
    if (!localMap.points.length) {
      ElMessage.warning('PCD 文件已读取，但没有解析到点数据')
      return
    }

    const formData = new FormData()
    const content = serializePcdAscii(localMap)
    formData.append('file', new Blob([content], { type: 'application/octet-stream' }), file.name)
    const res = await axios.post('/api/pcd/upload', formData)

    pcdMap = localMap
    currentName.value = res.data?.name || file.name
    dirty.value = false
    renderPcd()
    fitToView()

    await loadList()
    ElMessage.success(`上传并加载成功，共 ${localMap.points.length} 个点`)
  } catch (error: any) {
    console.error('上传 PCD 失败:', error)
    ElMessage.error(error?.response?.data?.message || error?.message || '上传 PCD 失败')
  }
}

async function openFile(name: string) {
  try {
    if (dirty.value) {
      await ElMessageBox.confirm('当前有未保存修改，确认切换文件吗？', '提示', { type: 'warning' })
    }
    const res = await axios.get(`/api/pcd/${encodeURIComponent(name)}`)
    const blob = new Blob([res.data.content], { type: 'text/plain' })
    const loadedMap = await parsePcdFile(new File([blob], name))
    if (!loadedMap.points.length) {
      ElMessage.warning('文件已打开，但没有解析到点数据')
    }
    pcdMap = loadedMap
    currentName.value = name
    dirty.value = false
    renderPcd()
    fitToView()
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('打开 PCD 失败:', error)
      ElMessage.error(error?.response?.data?.message || error?.message || '打开 PCD 失败')
    }
  }
}

async function saveCurrent() {
  if (!pcdMap || !currentName.value) return
  const points = getActivePoints()
  const content = serializePcdAscii({ header: { ...pcdMap.header, points: points.length, width: points.length, height: 1 }, points })
  await axios.put(`/api/pcd/${encodeURIComponent(currentName.value)}`, { content })
  dirty.value = false
  await loadList()
  ElMessage.success('保存成功')
}

async function deleteCurrent() {
  if (!currentName.value) return
  await ElMessageBox.confirm(`确认删除 ${currentName.value} 吗？`, '删除确认', { type: 'warning' })
  await axios.delete(`/api/pcd/${encodeURIComponent(currentName.value)}`)
  currentName.value = ''
  pcdMap = null
  dirty.value = false
  disposePointCloud()
  await loadList()
  ElMessage.success('删除成功')
}

function downloadCurrent() {
  if (!pcdMap) return
  const content = serializePcdAscii({ header: pcdMap.header, points: getActivePoints() })
  const url = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = currentName.value || 'map.pcd'
  link.click()
  URL.revokeObjectURL(url)
}

function initScene() {
  const container = canvasContainer.value
  if (!container) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf8fafc)
  const aspect = container.clientWidth / container.clientHeight
  camera = new THREE.OrthographicCamera(-50 * aspect, 50 * aspect, 50, -50, 0.1, 1000)
  camera.position.set(0, 0, 100)
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(container.clientWidth, container.clientHeight)
  container.appendChild(renderer.domElement)
  container.addEventListener('mousedown', onMouseDown)
  container.addEventListener('mousemove', onMouseMove)
  container.addEventListener('mouseup', onMouseUp)
  container.addEventListener('mouseleave', onMouseUp)
  container.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('resize', resize)
  render()
}

function renderPcd() {
  disposePointCloud()
  if (!scene || !pcdMap) return
  deletedMask = new Uint8Array(pcdMap.points.length)
  addedPoints = []
  const positions = new Float32Array(pcdMap.points.length * 3)
  pcdMap.points.forEach((point, index) => {
    positions[index * 3] = point.x
    positions[index * 3 + 1] = point.y
    positions[index * 3 + 2] = point.z
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({ color: 0x2563eb, size: pointSize.value, sizeAttenuation: false })
  pointCloud = new THREE.Points(geometry, material)
  scene.add(pointCloud)
  updateActiveCount()
  render()
}

function disposePointCloud() {
  if (pointCloud && scene) {
    scene.remove(pointCloud)
    pointCloud.geometry.dispose()
    pointCloud.material.dispose()
    pointCloud = null
  }
  render()
}

function rebuildPointCloud() {
  if (!pcdMap || !scene) return
  const points = getActivePoints()
  disposePointCloud()
  const positions = new Float32Array(points.length * 3)
  points.forEach((point, index) => {
    positions[index * 3] = point.x
    positions[index * 3 + 1] = point.y
    positions[index * 3 + 2] = point.z
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  pointCloud = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x2563eb, size: pointSize.value, sizeAttenuation: false }))
  scene.add(pointCloud)
  updateActiveCount()
  render()
}

function getActivePoints() {
  if (!pcdMap) return []
  const result: PcdPoint[] = []
  pcdMap.points.forEach((point, index) => {
    if (!deletedMask?.[index]) result.push(point)
  })
  result.push(...addedPoints)
  return result
}

function updateActiveCount() {
  activeCount.value = getActivePoints().length
}

function screenToWorld(event: MouseEvent) {
  const rect = renderer!.domElement.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  const y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  const vector = new THREE.Vector3(x, y, 0).unproject(camera!)
  return { x: vector.x, y: vector.y }
}

function onMouseDown(event: MouseEvent) {
  if (!pcdMap || !renderer) return
  lastMouse = { x: event.clientX, y: event.clientY }
  if (toolMode.value === 'move') {
    isPanning = true
    return
  }
  const world = screenToWorld(event)
  isDragging = true
  if (toolMode.value === 'add') addPoint(world.x, world.y)
  if (toolMode.value === 'erase') eraseAt(world.x, world.y)
  if (toolMode.value === 'rect') rectStart = world
}

function onMouseMove(event: MouseEvent) {
  if (isPanning && camera) {
    const dx = event.clientX - lastMouse.x
    const dy = event.clientY - lastMouse.y
    const scale = 100 / zoom / (renderer?.domElement.clientHeight || 1)
    camera.position.x -= dx * scale
    camera.position.y += dy * scale
    lastMouse = { x: event.clientX, y: event.clientY }
    render()
    return
  }
  if (!isDragging) return
  const world = screenToWorld(event)
  if (toolMode.value === 'add') addPoint(world.x, world.y)
  if (toolMode.value === 'erase') eraseAt(world.x, world.y)
}

function onMouseUp(event?: MouseEvent) {
  if (toolMode.value === 'rect' && rectStart && event) {
    const end = screenToWorld(event)
    eraseRect(Math.min(rectStart.x, end.x), Math.min(rectStart.y, end.y), Math.max(rectStart.x, end.x), Math.max(rectStart.y, end.y))
  }
  isPanning = false
  isDragging = false
  rectStart = null
}

function addPoint(x: number, y: number) {
  addedPoints.push({ x, y, z: addPointZ.value, values: { x, y, z: addPointZ.value } })
  dirty.value = true
  rebuildPointCloud()
}

function eraseAt(x: number, y: number) {
  if (!pcdMap || !deletedMask) return
  const r2 = brushRadius.value * brushRadius.value
  let changed = false
  pcdMap.points.forEach((point, index) => {
    if (deletedMask![index]) return
    const dx = point.x - x
    const dy = point.y - y
    if (dx * dx + dy * dy <= r2) {
      deletedMask![index] = 1
      changed = true
    }
  })
  addedPoints = addedPoints.filter(point => {
    const dx = point.x - x
    const dy = point.y - y
    const keep = dx * dx + dy * dy > r2
    if (!keep) changed = true
    return keep
  })
  if (changed) {
    dirty.value = true
    rebuildPointCloud()
  }
}

function eraseRect(minX: number, minY: number, maxX: number, maxY: number) {
  if (!pcdMap || !deletedMask) return
  let changed = false
  pcdMap.points.forEach((point, index) => {
    if (!deletedMask![index] && point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
      deletedMask![index] = 1
      changed = true
    }
  })
  addedPoints = addedPoints.filter(point => {
    const keep = !(point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY)
    if (!keep) changed = true
    return keep
  })
  if (changed) {
    dirty.value = true
    rebuildPointCloud()
  }
}

function clearAllPoints() {
  if (!pcdMap || !deletedMask) return
  deletedMask.fill(1)
  addedPoints = []
  dirty.value = true
  rebuildPointCloud()
}

function fitToView() {
  if (!camera || !canvasContainer.value) return
  const points = getActivePoints()
  if (!points.length) return
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  points.forEach(point => {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  })
  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  const aspect = canvasContainer.value.clientWidth / canvasContainer.value.clientHeight
  const viewSize = Math.max(width / aspect, height) * 1.2
  camera.left = -viewSize * aspect / 2
  camera.right = viewSize * aspect / 2
  camera.top = viewSize / 2
  camera.bottom = -viewSize / 2
  camera.position.set((minX + maxX) / 2, (minY + maxY) / 2, 100)
  camera.updateProjectionMatrix()
  render()
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  if (!camera) return
  zoom *= event.deltaY > 0 ? 0.9 : 1.1
  camera.zoom = zoom
  camera.updateProjectionMatrix()
  render()
}

function updatePointSize() {
  if (pointCloud) pointCloud.material.size = pointSize.value
  render()
}

function resize() {
  if (!renderer || !canvasContainer.value) return
  renderer.setSize(canvasContainer.value.clientWidth, canvasContainer.value.clientHeight)
  render()
}

function render() {
  if (renderer && scene && camera) renderer.render(scene, camera)
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(time: string) {
  return new Date(time).toLocaleString()
}

watch(toolMode, () => {
  isPanning = false
  isDragging = false
})

onMounted(async () => {
  initScene()
  await loadList()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  renderer?.dispose()
})
</script>
