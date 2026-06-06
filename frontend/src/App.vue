<template>
  <div class="pcd-editor-app">
    <!-- 顶部工具栏 -->
    <header class="editor-header">
      <div class="header-left">
        <h1 v-if="editingMapName" class="map-title">
          点云编辑 — {{ editingMapName }}
        </h1>
        <h1 v-else class="map-title">PCD 在线编辑器</h1>
      </div>
      <div class="header-right">
        <el-button 
          :icon="Upload" 
          type="primary"
          @click="handleOpenImportDialog"
        >
          导入地图
        </el-button>
        <el-button :icon="Refresh" @click="loadAllMaps">刷新</el-button>
      </div>
    </header>

    <!-- 主内容区域 -->
    <div class="main-content">
      <!-- 左侧：地图列表面板 -->
      <aside class="map-list-panel">
        <div class="panel-header">
          <span class="panel-title">点云地图列表</span>
          <div class="panel-actions">
            <el-button :icon="Refresh" circle size="small" @click="loadAllMaps" />
          </div>
        </div>

        <!-- 地图标签页 -->
        <el-tabs v-model="activeMapTab" type="card" class="map-tabs">
          <!-- 本地导入 -->
          <el-tab-pane :label="`本地导入 (${importedMaps.length})`" name="imported">
            <div class="map-table-wrapper">
              <table class="map-table" v-if="importedMaps.length > 0">
                <thead>
                  <tr>
                    <th>地图名称</th>
                    <th>大小</th>
                    <th>点位数</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="map in importedMaps" :key="map.name" :class="{ active: editingMapName === map.name }">
                    <td class="info-cell">
                      <div class="info-content-wrapper">
                        <div class="info-main-row">
                          <span class="map-name" :title="map.name">{{ map.name }}</span>
                          <span class="size-text">{{ formatSize(map.size) }}</span>
                          <span class="point-text">{{ map.pointCount ? map.pointCount.toLocaleString() : '-' }}</span>
                        </div>
                        <div class="local-map-meta">
                          <el-tag size="small" type="warning" effect="plain">本地</el-tag>
                        </div>
                      </div>
                    </td>
                    <td class="action-cell local-action-cell">
                      <div class="action-buttons-grid local-buttons">
                        <el-button type="primary" plain size="small" @click="handleUseMap(map)">使用</el-button>
                        <el-button type="warning" plain size="small" @click="handleEditMap(map)">编辑</el-button>
                        <el-button type="success" plain size="small" @click="handleExportMap(map)">导出</el-button>
                        <el-button type="danger" plain size="small" @click="handleDeleteImportedMap(map)">删除</el-button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="empty-state">
                <el-empty description="暂无本地导入的地图" :image-size="60" />
              </div>
            </div>
          </el-tab-pane>

          <!-- 分组地图 -->
          <el-tab-pane :label="`分组地图 (${groupMaps.length})`" name="group">
            <div class="map-table-wrapper">
              <div class="tab-actions">
                <el-button type="primary" size="small" :icon="Plus" @click="handleOpenCreateGroupDialog">
                  创建分组
                </el-button>
              </div>
              <table class="map-table" v-if="groupMaps.length > 0">
                <thead>
                  <tr>
                    <th>地图名称</th>
                    <th>文件组成</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="map in groupMaps" :key="map.groupId || map.name" :class="{ active: currentGroupId === (map.groupId || '') }">
                    <td class="group-info-cell">
                      <div class="info-content-wrapper">
                        <div class="info-main-row">
                          <span class="map-name">{{ map.mapName || map.name }}</span>
                          <el-tag size="small" :type="map.isComplete ? 'success' : 'warning'" effect="plain">
                            {{ map.isComplete ? '完整' : '不完整' }}
                          </el-tag>
                        </div>
                        <div class="file-tags-row">
                          <span class="file-tag" :class="{ active: !!map.pcdFileName }">PCD 点云</span>
                          <span class="file-tag" :class="{ active: !!map.pgmFileName }">PGM 栅格</span>
                          <span class="file-tag" :class="{ active: !!map.yamlFileName }">YAML 配置</span>
                        </div>
                      </div>
                    </td>
                    <td class="action-cell group-action-cell">
                      <div class="action-buttons-grid">
                        <el-button type="primary" plain size="small" :disabled="!map.pcdFileName" @click="handleUseGroupMap(map)">使用</el-button>
                        <el-button type="warning" plain size="small" @click="handleEditGroupMap(map)">编辑</el-button>
                        <el-button type="danger" plain size="small" @click="handleDeleteGroupMap(map)">删除</el-button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="empty-state">
                <el-empty description="暂无分组地图" :image-size="60" />
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </aside>

      <!-- 中间：编辑器画布区域 -->
      <main class="editor-canvas-area">
        <!-- 工具栏 -->
        <div class="canvas-toolbar">
          <div class="toolbar-left">
            <el-radio-group v-model="currentToolMode" size="default">
              <el-radio-button label="move">移动</el-radio-button>
              <el-radio-button label="add">点云绘制</el-radio-button>
              <el-radio-button label="erase">点云擦除</el-radio-button>
              <el-radio-button label="erase-rect">框选点云擦除</el-radio-button>
              <el-radio-button label="grid-occupy">添加栅格</el-radio-button>
              <el-radio-button label="grid-free">擦除栅格</el-radio-button>
              <el-radio-button label="grid-erase-rect">框选擦除栅格</el-radio-button>
            </el-radio-group>

            <el-divider direction="vertical" />

            <span class="param-label">参数</span>
            
            <span class="param-item">
              <span>圆刷半径</span>
              <el-input-number
                v-model="currentBrushRadius"
                :min="0.05"
                :max="5"
                :step="0.1"
                :precision="1"
                size="small"
                style="width: 90px"
              />
            </span>
          </div>

          <div class="toolbar-right">
            <el-button
              type="success"
              :disabled="!editingMapName"
              @click="handleOpenSubmitDialog"
            >
              提交到服务器
            </el-button>
            <el-dropdown trigger="click" @command="handleSaveCommand">
              <el-button type="primary" :disabled="!editingMapName">
                保存<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="save">保存修改</el-dropdown-item>
                  <el-dropdown-item command="saveAs">另存为...</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>

        <!-- 画布容器 -->
        <div ref="canvasContainer" class="canvas-container" @mousedown="onCanvasMouseDown" @mousemove="onCanvasMouseMove" @mouseup="onCanvasMouseUp" @wheel.prevent="onCanvasWheel" @contextmenu.prevent>
          <canvas ref="gridCanvasRef" class="grid-canvas"></canvas>
          
          <!-- 空状态提示 -->
          <div v-if="!editingMapName && !pcdFileLoader.loading.value" class="empty-canvas-hint">
            <el-empty description="请从左侧选择或导入一个地图开始编辑" />
          </div>

          <!-- 加载状态 -->
          <div v-if="pcdFileLoader.loading.value" class="loading-overlay">
            <el-progress
              :percentage="Math.round(pcdFileLoader.progress.value || 0)"
              :stroke-width="8"
              :format="(pct: number) => pct >= 100 ? '加载完成' : `${pct}%`"
            />
            <span class="loading-text">{{ pcdFileLoader.loadText.value || '加载中...' }}</span>
          </div>
        </div>

        <!-- 底部状态栏 -->
        <footer class="status-bar">
          <div class="status-left">
            <span class="stat-item">
              <span class="stat-label">点数:</span>
              <span class="stat-value">{{ activePointCount.toLocaleString() }}</span>
            </span>
            <span class="stat-separator">|</span>
            <span class="stat-item">
              <span class="stat-label">圆刷:</span>
              <span class="stat-value">{{ currentBrushRadius.toFixed(2) }}m</span>
            </span>
            <span class="stat-separator">|</span>
            <span class="stat-item">
              <span class="stat-label">模式:</span>
              <span class="stat-value">{{ getToolModeLabel(currentToolMode) }}</span>
            </span>
            <span v-if="occupancyGrid.grid.value?.image" class="stat-separator">|</span>
            <span v-if="occupancyGrid.grid.value?.image" class="stat-item">
              <span class="stat-label">栅格:</span>
              <span class="stat-value">{{ occupancyGrid.grid.value.image.width }}×{{ occupancyGrid.grid.value.image.height }}</span>
            </span>
          </div>
          <div class="status-right">
            <el-tag v-if="dirty" type="warning" size="small" effect="dark">未保存</el-tag>
          </div>
        </footer>
      </main>

      <!-- 右侧：属性面板 -->
      <aside class="property-panel" v-if="editingMapName">
        <!-- 文件信息 -->
        <el-collapse v-model="activeCollapsePanels">
          <el-collapse-item title="文件信息" name="fileInfo">
            <div class="info-section">
              <div class="info-row">
                <span class="info-label">文件名</span>
                <span class="info-value">{{ currentFileInfo?.name || editingMapName }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">点数</span>
                <span class="info-value">{{ activePointCount.toLocaleString() }}</span>
              </div>
              <div class="info-row" v-if="occupancyGrid.grid.value?.image">
                <span class="info-label">栅格</span>
                <span class="info-value">{{ occupancyGrid.grid.value.image.width }}×{{ occupancyGrid.grid.value.image.height }}</span>
              </div>
            </div>
          </el-collapse-item>

          <!-- 文件分组 -->
          <el-collapse-item title="文件分组" name="fileGroup" v-if="currentGroupId">
            <div class="group-info-card">
              <div class="group-header">
                <el-icon><FolderOpened /></el-icon>
                <span>文件分组信息</span>
              </div>
              <div class="group-details">
                <div class="detail-row">
                  <span class="detail-label">分组ID:</span>
                  <span class="detail-value">{{ currentGroupId }}</span>
                  <el-button link size="small" @click="copyToClipboard(currentGroupId)">
                    <CopyDocument />
                  </el-button>
                </div>
                <div class="detail-row">
                  <span class="detail-label">地图名:</span>
                  <span class="detail-value">{{ editingMapName }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">日期:</span>
                  <span class="detail-value">{{ new Date().toLocaleDateString('zh-CN') }}</span>
                </div>
                
                <div class="group-files-status">
                  <div class="file-status-item" :class="{ active: hasPcdFile }">
                    <span class="status-dot"></span>
                    <span>PCD 点云</span>
                    <el-tag size="small" :type="hasPcdFile ? 'success' : 'info'" effect="plain">
                      {{ hasPcdFile ? '已保存' : '未保存' }}
                    </el-tag>
                  </div>
                  <div class="file-status-item" :class="{ active: hasPgmFile }">
                    <span class="status-dot"></span>
                    <span>PGM 栅格</span>
                    <el-tag size="small" :type="hasPgmFile ? 'success' : 'info'" effect="plain">
                      {{ hasPgmFile ? formatSize(pgmFileSize) + ' 已保存' : '未保存' }}
                    </el-tag>
                  </div>
                  <div class="file-status-item" :class="{ active: hasYamlFile }">
                    <span class="status-dot"></span>
                    <span>YAML 配置</span>
                    <el-tag size="small" :type="hasYamlFile ? 'success' : 'info'" effect="plain">
                      {{ hasYamlFile ? yamlFileSize + 'B 已保存' : '未保存' }}
                    </el-tag>
                  </div>
                </div>

                <el-button class="reload-btn" @click="loadCurrentGroupFiles">
                  <Refresh />重新加载
                </el-button>
              </div>
            </div>
          </el-collapse-item>

          <!-- 占用栅格 -->
          <el-collapse-item title="占用栅格" name="occupancyGrid">
            <div class="grid-control">
              <el-switch 
                v-model="showOccupancyGrid" 
                active-text="显示栅格"
                inactive-text=""
                @change="onToggleGridDisplay"
              />
            </div>
          </el-collapse-item>
        </el-collapse>
      </aside>
    </div>

    <!-- 导入地图对话框 -->
    <el-dialog
      v-model="showImportDialog"
      title="导入地图文件"
      width="420px"
      :close-on-click-modal="false"
      @close="resetImportForm"
    >
      <el-form :model="importForm" label-width="90px">
        <el-form-item label="地图名称">
          <el-input
            v-model="importForm.mapName"
            placeholder="自动生成时间戳名称"
            clearable
          />
        </el-form-item>
        <el-form-item label="选择文件">
          <el-upload
            ref="uploadRef"
            :auto-upload="false"
            :limit="10"
            accept=".pcd,.pgm,.yaml,.yml"
            :on-change="onFileSelected"
            :on-remove="onFileRemoved"
            drag
            multiple
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">点击或拖拽文件到此处</div>
            <template #tip>
              <div class="el-upload__tip">支持 .pcd / .pgm / .yaml 格式</div>
            </template>
          </el-upload>
          <div v-if="selectedFiles.length > 0" style="margin-top: 8px; color: #606266; font-size: 13px;">
            已选择 {{ selectedFiles.length }} 个文件
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showImportDialog = false">取消</el-button>
        <el-button
          type="primary"
          :loading="importing"
          :disabled="selectedFiles.length === 0"
          @click="doImportAndOpenEditor"
        >
          导入并打开
        </el-button>
      </template>
    </el-dialog>

    <!-- 提交到服务器确认对话框 -->
    <SubmitConfirmDialog
      v-model="showSubmitDialog"
      :groupMeta="pcdFileLoader.groupMeta.value"
      :submitting="submitting"
      :progress="submitProgress"
      :total="submitTotal"
      :progressText="submitProgressText"
      :submitResult="submitResult"
      :resultMessage="submitResultMessage"
      @confirm="handleSubmitConfirm"
      @cancel="showSubmitDialog = false"
    />

    <!-- 删除确认对话框 -->
    <el-dialog
      v-model="showDeleteConfirm"
      title="确认删除"
      width="400px"
    >
      <p>{{ deleteConfirmMessage }}</p>
      <template #footer>
        <el-button @click="showDeleteConfirm = false">取消</el-button>
        <el-button type="danger" @click="confirmDelete">确认删除</el-button>
      </template>
    </el-dialog>

    <!-- 擦除确认对话框 -->
    <el-dialog
      v-model="showEraseConfirm"
      title="确认擦除"
      width="400px"
    >
      <p>{{ eraseConfirmMessage }}</p>
      <template #footer>
        <el-button @click="showEraseConfirm = false">取消</el-button>
        <el-button type="danger" @click="confirmErase">确认擦除</el-button>
      </template>
    </el-dialog>

    <!-- 创建分组对话框 -->
    <el-dialog
      v-model="showCreateGroupDialog"
      title="创建新分组"
      width="480px"
      :close-on-click-modal="false"
      @close="resetCreateGroupForm"
    >
      <el-form :model="createGroupForm" label-width="100px" label-position="top">
        <el-form-item label="地图名称" required>
          <el-input
            v-model="createGroupForm.mapName"
            placeholder="请输入地图名称"
            clearable
          />
        </el-form-item>
        <el-form-item label="日期标签">
          <el-date-picker
            v-model="createGroupForm.dateTag"
            type="date"
            placeholder="选择日期"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="上传文件">
          <el-upload
            ref="groupUploadRef"
            :auto-upload="false"
            :on-change="handleGroupFileChange"
            :on-remove="handleGroupFileRemove"
            multiple
            accept=".pcd,.pgm,.yaml,.yml"
            :limit="10"
            :file-list="groupFileList"
          >
            <template #trigger>
              <el-button type="primary" plain>选择文件</el-button>
            </template>
            <template #tip>
              <div class="upload-tip">
                支持 .pcd, .pgm, .yaml, .yml 格式，最多10个文件
              </div>
            </template>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateGroupDialog = false">取消</el-button>
        <el-button type="primary" :loading="creatingGroup" @click="handleCreateGroup">
          创建分组
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  Upload,
  Refresh,
  ZoomOut,
  Plus,
  Minus,
  RefreshRight,
  ArrowDown,
  FolderOpened,
  CopyDocument,
  Document,
  UploadFilled,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import * as THREE from 'three'

// 配置axios默认设置
axios.defaults.timeout = 120000

// 导入composables
import { usePcdBrushEdit } from './composables/usePcdBrushEdit'
import { usePcdFileLoader } from './composables/usePcdFileLoader'
import { useOccupancyGrid } from './composables/useOccupancyGrid'
import { useThreeScene } from './composables/useThreeScene'
import { useThreeMouseControls } from './composables/useThreeMouseControls'
import SubmitConfirmDialog from './components/SubmitConfirmDialog.vue'

// ==================== 响应式状态 ====================

// 地图相关状态
const editingMapName = ref<string>('')
const currentGroupId = ref<string>('')
const activeMapTab = ref('imported')
const importedMaps = ref<any[]>([])
const groupMaps = ref<any[]>([])

// UI状态
const showImportDialog = ref(false)
const showDeleteConfirm = ref(false)
const showCreateGroupDialog = ref(false)
const deleteConfirmMessage = ref('')
const deleteTargetMap = ref<any>(null)

// 擦除确认状态
const showEraseConfirm = ref(false)
const eraseConfirmMessage = ref('')
const pendingErase = ref<{ mode: string; minX: number; minY: number; maxX: number; maxY: number } | null>(null)

// 提交到服务器对话框状态
const showSubmitDialog = ref(false)
const submitting = ref(false)
const submitProgress = ref(0)
const submitTotal = ref(3)
const submitProgressText = ref('')
const submitResult = ref<'success' | 'partial' | 'fail' | ''>('')
const submitResultMessage = ref('')
const importing = ref(false)
const creatingGroup = ref(false)
const importProgress = ref(0)
const importStatusText = ref('')

// 创建分组表单
const createGroupForm = reactive({
  mapName: '',
  dateTag: new Date().toISOString().slice(0, 10)
})
const groupFileList = ref<any[]>([])
const groupUploadRef = ref()
const groupRawFiles = ref<File[]>([])

// 折叠面板
const activeCollapsePanels = ref(['fileInfo', 'fileGroup', 'occupancyGrid'])

// 栅格显示控制
const showOccupancyGrid = ref(true)

// 导入表单
const importForm = reactive({
  mapName: '',
})

interface SelectedFile {
  name: string
  size: number
  file?: File
}
const selectedFiles = ref<SelectedFile[]>([])
const uploadRef = ref()

// 文件信息
const currentFileInfo = ref<any>(null)
const hasPcdFile = computed(() => !!editingMapName.value)
const hasPgmFile = ref(false)
const pgmFileSize = ref(0)
const hasYamlFile = ref(false)
const yamlFileSize = ref(0)

// ==================== Composables初始化 ====================

const canvasContainer = ref<HTMLElement>()
const gridCanvasRef = ref<HTMLCanvasElement>()

const cameraPosition = ref(new THREE.Vector3(0, 0, 100))
const cameraZoom = ref(1)
const baseViewSize = ref(100)

const brushEdit = usePcdBrushEdit({
  getScene: () => threeScene?.getScene() ?? null,
  getCamera: () => threeScene?.getCamera() as any ?? null,
  render: () => renderAllLayers(),
  updateCameraView: () => threeScene?.updateCameraView(),
  container: canvasContainer,
  onEdit: () => { dirty.value = true }
})

// 本地 ref 用于模板 v-model（嵌套 ref 不会在模板中自动解包）
const currentToolMode = ref<string>('move')
const currentBrushRadius = ref<number>(0.5)

// 双向同步
watch(currentToolMode, (val) => { brushEdit.toolMode.value = val as any })
watch(() => brushEdit.toolMode, (ref) => {
  if (ref?.value && ref.value !== currentToolMode.value) {
    currentToolMode.value = ref.value
  }
}, { immediate: true })

watch(currentBrushRadius, (val) => { brushEdit.brushRadius.value = val })
watch(() => brushEdit.brushRadius, (ref) => {
  if (ref?.value !== undefined && ref.value !== currentBrushRadius.value) {
    currentBrushRadius.value = ref.value
  }
}, { immediate: true })

const pcdFileLoader = usePcdFileLoader()
const occupancyGrid = useOccupancyGrid({
  gridCanvasRef: gridCanvasRef,
  getViewport: () => {
    if (!threeScene || !canvasContainer.value) return null
    const camera = threeScene.getCamera() as THREE.OrthographicCamera
    if (!camera) return null
    const container = canvasContainer.value
    return {
      centerX: camera.position.x,
      centerY: camera.position.y,
      scale: container.clientWidth / (camera.right - camera.left),
      width: container.clientWidth,
      height: container.clientHeight,
    }
  }
})

const dirty = ref(false)

// ==================== 鼠标事件处理 ====================
let isDrawing = false
let rectStartPos = { x: 0, y: 0 }

function getWorldPos(clientX: number, clientY: number): { x: number; y: number } | null {
  // 优先使用mouseControls的screenToWorld（更准确）
  if (mouseControls) {
    return mouseControls.screenToWorld(clientX, clientY)
  }
  // fallback
  if (!threeScene || !canvasContainer.value) return null
  const camera = threeScene.getCamera() as THREE.OrthographicCamera
  if (!camera) return null

  const rect = canvasContainer.value.getBoundingClientRect()
  const normalizedX = (clientX - rect.left) / rect.width
  const normalizedY = (clientY - rect.top) / rect.height

  return {
    x: camera.position.x + camera.left + normalizedX * (camera.right - camera.left),
    y: camera.position.y + camera.top - normalizedY * (camera.top - camera.bottom)
  }
}

function onCanvasMouseDown(e: MouseEvent) {
  const mode = currentToolMode.value

  // 右键或中键始终用于平移
  if (e.button === 2 || e.button === 1) {
    if (mouseControls) mouseControls.handleMouseDown(e)
    return
  }

  // 左键：move 模式用于平移
  if (mode === 'move' || !mode) {
    if (mouseControls) mouseControls.handleMouseDown(e)
    return
  }

  // 左键 + 其他工具模式：执行编辑操作
  if (!brushEdit) return

  const worldPos = getWorldPos(e.clientX, e.clientY)
  if (!worldPos) return

  console.log('[鼠标] 模式:', mode, '位置:', worldPos)

  if (mode === 'add') {
    brushEdit.addSinglePoint(worldPos.x, worldPos.y, brushEdit.addPointZ.value)
    isDrawing = true
  } else if (mode === 'erase') {
    brushEdit.eraseByBrush(worldPos.x, worldPos.y, currentBrushRadius.value)
    isDrawing = true
  } else if (mode === 'erase-rect' || mode === 'grid-erase-rect') {
    isDrawing = true
    rectStartPos = { x: worldPos.x, y: worldPos.y }
  } else if (mode === 'grid-occupy') {
    occupancyGrid.paintDisk(worldPos.x, worldPos.y, currentBrushRadius.value, true)
    if (occupancyGrid.grid.value) pcdFileLoader.occupancyGridMap.value = occupancyGrid.grid.value
    dirty.value = true
    scheduleGridDraw()
    isDrawing = true
  } else if (mode === 'grid-free') {
    occupancyGrid.paintDisk(worldPos.x, worldPos.y, currentBrushRadius.value, false)
    if (occupancyGrid.grid.value) pcdFileLoader.occupancyGridMap.value = occupancyGrid.grid.value
    dirty.value = true
    scheduleGridDraw()
    isDrawing = true
  }
}

function onCanvasMouseMove(e: MouseEvent) {
  if (!isDrawing && mouseControls) mouseControls.handleMouseMove(e)

  if (!isDrawing || !brushEdit) return
  const mode = currentToolMode.value
  const worldPos = getWorldPos(e.clientX, e.clientY)
  if (!worldPos) return

  if (mode === 'erase') {
    brushEdit.eraseByBrush(worldPos.x, worldPos.y, currentBrushRadius.value)
  } else if (mode === 'add') {
    brushEdit.addPointByBrush(worldPos.x, worldPos.y, brushEdit.addPointZ.value, 0.1)
  } else if (mode === 'grid-occupy') {
    occupancyGrid.paintDisk(worldPos.x, worldPos.y, currentBrushRadius.value, true)
    if (occupancyGrid.grid.value) pcdFileLoader.occupancyGridMap.value = occupancyGrid.grid.value
    dirty.value = true
    scheduleGridDraw()
  } else if (mode === 'grid-free') {
    occupancyGrid.paintDisk(worldPos.x, worldPos.y, currentBrushRadius.value, false)
    if (occupancyGrid.grid.value) pcdFileLoader.occupancyGridMap.value = occupancyGrid.grid.value
    dirty.value = true
    scheduleGridDraw()
  }
}

function onCanvasMouseUp(e: MouseEvent) {
  // 平移结束处理
  if (mouseControls) mouseControls.handleMouseUp(e)

  if (!isDrawing || !brushEdit) {
    isDrawing = false
    return
  }

  const mode = currentToolMode.value
  const worldPos = getWorldPos(e.clientX, e.clientY)
  if (worldPos && (mode === 'erase-rect' || mode === 'grid-erase-rect')) {
    const minX = Math.min(rectStartPos.x, worldPos.x)
    const maxX = Math.max(rectStartPos.x, worldPos.x)
    const minY = Math.min(rectStartPos.y, worldPos.y)
    const maxY = Math.max(rectStartPos.y, worldPos.y)

    // 框选擦除需要二次确认
    const label = mode === 'erase-rect' ? '点云' : '栅格'
    pendingErase.value = { mode, minX, minY, maxX, maxY }
    eraseConfirmMessage.value = `确认要擦除框选区域内的${label}吗？\n区域: [${minX.toFixed(2)}, ${minY.toFixed(2)}] 至 [${maxX.toFixed(2)}, ${maxY.toFixed(2)}]`
    showEraseConfirm.value = true
  }

  isDrawing = false
}

// 确认擦除
function confirmErase() {
  if (!pendingErase.value) return
  const { mode, minX, minY, maxX, maxY } = pendingErase.value
  if (mode === 'erase-rect') {
    brushEdit.eraseByRect(minX, minY, maxX, maxY)
  } else {
    occupancyGrid.eraseByRect(minX, minY, maxX, maxY)
    if (occupancyGrid.grid.value) pcdFileLoader.occupancyGridMap.value = occupancyGrid.grid.value
    dirty.value = true
    scheduleGridDraw()
  }
  showEraseConfirm.value = false
  pendingErase.value = null
}

// 调度栅格重绘
let gridDrawRAF = 0
function renderAllLayers() {
  threeScene?.render()
  scheduleGridDraw()
}

function scheduleGridDraw() {
  if (gridDrawRAF) return
  gridDrawRAF = requestAnimationFrame(() => {
    gridDrawRAF = 0
    occupancyGrid.drawGrid()
  })
}

function onCanvasWheel(e: WheelEvent) {
  if (mouseControls) {
    mouseControls.handleWheel(e)
  }
}

let threeScene: ReturnType<typeof useThreeScene> | null = null
let mouseControls: ReturnType<typeof useThreeMouseControls> | null = null

// ==================== 计算属性 ====================

const selectedFilesDisplay = computed(() => 
  selectedFiles.value.map(f => ({
    name: f.name,
    size: f.size,
    status: 'ready',
  }))
)

const activePointCount = computed(() => brushEdit.getActivePoints().length)

// ==================== 方法 ====================

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatTime(dateStr: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString('zh-CN')
}

function getToolModeLabel(mode: string | undefined): string {
  if (!mode) return '移动'
  const labels: Record<string, string> = {
    'move': '移动',
    'add': '点云绘制',
    'erase': '点云擦除',
    'erase-rect': '框选点云擦除',
    'grid-occupy': '添加栅格',
    'grid-free': '擦除栅格',
    'grid-erase-rect': '框选擦除栅格',
  }
  return labels[mode] || mode
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    ElMessage.success('已复制到剪贴板')
  })
}

// ==================== 地图加载方法 ====================

async function loadAllMaps() {
  try {
    // 加载本地导入的地图（即pcd文件夹中的文件）
    const res = await axios.get('/api/dispatch/agv/mapping/import/list')
    const importedItems = res.data?.data?.items || res.data?.items || res.data?.data || []
    if (res.data?.success && Array.isArray(importedItems)) {
      importedMaps.value = importedItems.map((item: any) => ({
        ...item,
        name: item.name || item.mapName || item.mapFileName,
        size: item.size || item.fileSize || 0,
        pointCount: item.pointCount || 0,
        updateTime: item.updateTime || item.updatedAt || item.createTime,
        source: 'local'
      }))
    }

    // 加载分组地图（包含所有已导入的分组）
    try {
      const groupsRes = await axios.get('/api/dispatch/agv/mapping/pointcloud/groups')
      const groupItems = groupsRes.data?.data?.items || groupsRes.data?.items || groupsRes.data?.data || []
      if (groupsRes.data?.success && Array.isArray(groupItems)) {
        groupMaps.value = groupItems.map((g: any) => ({
          ...g,
          isComplete: !!(g.pcdFileName),
          source: 'group'
        }))
      }
    } catch (e) {
      console.warn('加载分组地图失败:', e)
      groupMaps.value = []
    }

    console.log(`[地图列表] 本地: ${importedMaps.value.length}, 分组: ${groupMaps.value.length}`)
  } catch (error) {
    console.error('加载地图列表失败:', error)
    ElMessage.error('加载地图列表失败')
  }
}

// ==================== 地图操作方法 ====================

function handleOpenImportDialog() {
  // 自动生成时间戳地图名
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  importForm.mapName = `map_${ts}`
  
  // 重置文件列表
  selectedFiles.value = []
  
  showImportDialog.value = true
}

function resetImportForm() {
  importForm.mapName = ''
  selectedFiles.value = []
  if (uploadRef.value) {
    uploadRef.value.clearFiles()
  }
}

function onFileSelected(uploadFile: any) {
  if (!selectedFiles.value.find(f => f.name === uploadFile.name)) {
    selectedFiles.value.push({
      name: uploadFile.name,
      size: uploadFile.size || 0,
      file: uploadFile.raw
    })
  }
  
  // 如果没有填写地图名称，使用第一个PCD文件的名称
  if (!importForm.mapName && uploadFile.name.toLowerCase().endsWith('.pcd')) {
    importForm.mapName = uploadFile.name.replace(/\.pcd$/i, '')
  }
}

function onFileRemoved(uploadFile: any) {
  selectedFiles.value = selectedFiles.value.filter(f => f.name !== uploadFile.name)
}

function removeSelectedFile(file: SelectedFile) {
  selectedFiles.value = selectedFiles.value.filter(f => f.name !== file.name)
}

async function doImportAndOpenEditor() {
  if (!selectedFiles.value.length) return

  importing.value = true
  importProgress.value = 0
  importStatusText.value = '正在准备...'

  try {
    // 1. 加载本地文件到编辑器
    const filesToLoad = selectedFiles.value
      .map(f => f.file)
      .filter((f): f is File => !!f)

    await pcdFileLoader.loadLocalFiles(filesToLoad)

    // 初始化点云到场景
    if (pcdFileLoader.pcdMap.value) {
      console.log('[导入] 初始化点云, 点数:', pcdFileLoader.pcdMap.value.points.length)
      console.log('[导入] threeScene 状态:', !!threeScene)

      if (threeScene) {
        const scene = threeScene.getScene()
        console.log('[导入] scene 状态:', !!scene)
      }

      brushEdit.initPointCloud(pcdFileLoader.pcdMap.value)

      // 强制渲染
      nextTick(() => {
        threeScene?.render()
        fitViewToData()
        console.log('[导入] 渲染完成')
      })
    } else {
      console.warn('[导入] pcdMap 为空')
    }

    // 初始化栅格地图（如果已加载 PGM/YAML）
    if (pcdFileLoader.occupancyGridMap.value) {
      console.log('[导入] 初始化栅格地图')
      occupancyGrid.grid.value = pcdFileLoader.occupancyGridMap.value
      occupancyGrid.invalidateCache()
      nextTick(() => {
        scheduleGridDraw()
      })
    }

    // 2. 设置地图名称
    const mapName = importForm.mapName.trim() || `map_${Date.now()}`
    editingMapName.value = mapName

    // 3. 生成分组ID，初始化分组状态
    const groupId = crypto.randomUUID?.() || `group_${Date.now()}`
    currentGroupId.value = groupId
    pcdFileLoader.initGroup(groupId, mapName)

    // 标记本地已加载的文件
    const hasPcd = filesToLoad.some(f => f.name.endsWith('.pcd'))
    const hasPgm = filesToLoad.some(f => f.name.endsWith('.pgm'))
    const hasYaml = filesToLoad.some(f => f.name.endsWith('.yaml') || f.name.endsWith('.yml'))
    if (hasPcd) {
      const pcdFile = filesToLoad.find(f => f.name.endsWith('.pcd'))
      pcdFileLoader.markFileLoaded('pointcloud', pcdFile?.name, pcdFile?.size)
    }
    if (hasPgm) {
      const pgmFile = filesToLoad.find(f => f.name.endsWith('.pgm'))
      pcdFileLoader.markFileLoaded('occupancy', pgmFile?.name, pgmFile?.size)
    }
    if (hasYaml) {
      const yamlFile = filesToLoad.find(f => f.name.endsWith('.yaml') || f.name.endsWith('.yml'))
      pcdFileLoader.markFileLoaded('yaml', yamlFile?.name, yamlFile?.size)
    }

    // 4. 上传文件到服务器
    await uploadFilesToServer(filesToLoad, mapName, groupId)

    // 6. 关闭对话框并显示编辑器
    showImportDialog.value = false
    resetImportForm()

    // 7. 刷新地图列表
    await loadAllMaps()

    ElMessage.success(`已打开编辑器：${mapName}`)

  } catch (error: any) {
    console.error('导入失败:', error)
    ElMessage.error(error?.message || '导入失败')
  } finally {
    importing.value = false
    pcdFileLoader.loading.value = false
    pcdFileLoader.progress.value = 0
  }
}

async function uploadFilesToServer(files: File[], mapName: string, groupId: string) {
  const formData = new FormData()
  
  for (const file of files) {
    formData.append('files', file, file.name)
  }

  formData.append('mapName', mapName)
  formData.append('groupId', groupId)

  try {
    const res = await axios.post('/api/dispatch/agv/mapping/import/bundle', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000,
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          importProgress.value = Math.round((progressEvent.loaded / progressEvent.total) * 90)
          const loadedMB = (progressEvent.loaded / 1024 / 1024).toFixed(1)
          const totalMB = (progressEvent.total / 1024 / 1024).toFixed(1)
          importStatusText.value = `正在上传... ${loadedMB}MB / ${totalMB}MB`
        }
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    })

    if (res.data?.success) {
      importProgress.value = 100
      importStatusText.value = '✓ 上传完成'

      // 更新文件状态
      hasPgmFile.value = files.some(f => f.name.endsWith('.pgm'))
      hasYamlFile.value = files.some(f => f.name.endsWith('.yaml') || f.name.endsWith('.yml'))

      const pgmFile = files.find(f => f.name.endsWith('.pgm'))
      if (pgmFile) pgmFileSize.value = pgmFile.size

      const yamlFile = files.find(f => f.name.endsWith('.yaml') || f.name.endsWith('.yml'))
      if (yamlFile) yamlFileSize.value = yamlFile.size

      // 标记文件已保存到服务器（更新分组状态）
      const pcdFile = files.find(f => f.name.endsWith('.pcd'))
      if (pcdFile) pcdFileLoader.markFileSaved('pointcloud', pcdFile.name, pcdFile.size)
      if (pgmFile) pcdFileLoader.markFileSaved('occupancy', pgmFile.name, pgmFile.size)
      if (yamlFile) pcdFileLoader.markFileSaved('yaml', yamlFile.name, yamlFile.size)
    }
  } catch (error: any) {
    console.error('上传到服务器失败:', error)
    // 上传失败不影响本地编辑，只是无法持久化
    ElMessage.warning('文件上传到服务器失败，但可以在本地继续编辑')
  }
}

// ==================== 提交到服务器 ====================

function handleOpenSubmitDialog() {
  if (!editingMapName.value) {
    ElMessage.warning('没有正在编辑的地图')
    return
  }
  if (!pcdFileLoader.groupMeta.value) {
    // 如果没有分组元数据，临时创建一个
    const gid = currentGroupId.value || (crypto.randomUUID?.() || `group_${Date.now()}`)
    pcdFileLoader.initGroup(gid, editingMapName.value)
    currentGroupId.value = gid
  }
  // 重置提交状态
  submitResult.value = ''
  submitResultMessage.value = ''
  submitProgress.value = 0
  showSubmitDialog.value = true
}

async function handleSubmitConfirm(types: string[]) {
  if (!editingMapName.value || !pcdFileLoader.groupMeta.value) return

  submitting.value = true
  submitProgress.value = 0
  submitTotal.value = types.length
  submitResult.value = ''
  submitResultMessage.value = ''

  let successCount = 0
  let failCount = 0

  try {
    const groupId = pcdFileLoader.groupMeta.value.groupId

    // 确保服务器上有该分组
    try {
      await axios.post('/api/dispatch/agv/mapping/import/bundle', {
        groupId,
        mapName: editingMapName.value,
        dateTag: pcdFileLoader.groupMeta.value.dateTag
      })
    } catch (e) {
      // 分组可能已存在，忽略错误
    }

    for (const type of types) {
      submitProgressText.value = `正在提交 ${type === 'pointcloud' ? 'PCD点云' : type === 'occupancy' ? 'PGM栅格' : 'YAML配置'}...`

      try {
        if (type === 'pointcloud' && pcdFileLoader.pcdMap.value) {
          // 提交当前编辑的点云数据
          const content = brushEdit.exportToString()
          const blob = new Blob([content], { type: 'text/plain' })
          const file = new File([blob], pcdFileLoader.groupMeta.value.files.pointcloud.fileName || `${editingMapName.value}.pcd`)
          const formData = new FormData()
          formData.append('file', file)
          formData.append('fileType', 'pointcloud')
          formData.append('mapName', editingMapName.value)
          await axios.post(`/api/dispatch/agv/mapping/pointcloud/save/${encodeURIComponent(groupId)}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 300000
          })
          pcdFileLoader.markFileSaved('pointcloud', file.name, blob.size)
          successCount++
        } else if (type === 'occupancy' && occupancyGrid.grid.value) {
          // 提交栅格地图
          const serialized = occupancyGrid.getSerializedFiles(editingMapName.value)
          if (serialized) {
            const formData = new FormData()
            const pgmFile = new File([serialized.pgmBlob], pcdFileLoader.groupMeta.value.files.occupancy.fileName || 'map.pgm')
            formData.append('file', pgmFile)
            formData.append('fileType', 'occupancy')
            await axios.post(`/api/dispatch/agv/mapping/pointcloud/save/${encodeURIComponent(groupId)}`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 120000
            })
            pcdFileLoader.markFileSaved('occupancy', pgmFile.name, serialized.pgmBlob.size)
            successCount++
          }
        } else if (type === 'yaml' && occupancyGrid.grid.value) {
          // 提交 YAML 配置
          const serialized = occupancyGrid.getSerializedFiles(editingMapName.value)
          if (serialized) {
            const yamlBlob = new Blob([serialized.yamlText], { type: 'text/yaml' })
            const yamlFile = new File([yamlBlob], pcdFileLoader.groupMeta.value.files.yaml.fileName || 'map.yaml')
            const formData = new FormData()
            formData.append('file', yamlFile)
            formData.append('fileType', 'yaml')
            await axios.post(`/api/dispatch/agv/mapping/pointcloud/save/${encodeURIComponent(groupId)}`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 60000
            })
            pcdFileLoader.markFileSaved('yaml', yamlFile.name, yamlBlob.size)
            successCount++
          }
        } else {
          // 没有数据可提交
          failCount++
        }
      } catch (e) {
        console.error(`提交 ${type} 失败:`, e)
        failCount++
      }

      submitProgress.value++
    }

    if (failCount === 0) {
      submitResult.value = 'success'
      submitResultMessage.value = `✅ 全部提交成功（${successCount} 个文件）`
      dirty.value = false
      await loadAllMaps()
    } else if (successCount > 0) {
      submitResult.value = 'partial'
      submitResultMessage.value = `⚠️ 部分提交成功（${successCount} 成功，${failCount} 失败）`
    } else {
      submitResult.value = 'fail'
      submitResultMessage.value = '❌ 提交失败，请重试'
    }
  } catch (error: any) {
    console.error('提交失败:', error)
    submitResult.value = 'fail'
    submitResultMessage.value = '❌ ' + (error?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

async function handleUseMap(map: any) {
  try {
    await ElMessageBox.confirm(
      `确定要使用地图「${map.name}」吗？`,
      '确认使用',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'info' }
    )
    
    // 设置为当前激活的地图
    await axios.post('/api/dispatch/agv/mapping/import/activate/' + encodeURIComponent(map.name))
    
    // 如果还没在编辑中，则打开编辑
    if (editingMapName.value !== map.name) {
      await openMapForEditing(map.name)
    }
    
    ElMessage.success(`已设置为当前使用的地图：${map.name}`)
    await loadAllMaps()
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('使用地图失败:', error)
      ElMessage.error('操作失败')
    }
  }
}

async function handleEditMap(map: any) {
  await openMapForEditing(map.name)
}

async function handleExportMap(map: any) {
  try {
    const res = await axios.get(`/api/dispatch/agv/mapping/pointcloud/download/${encodeURIComponent(map.name)}`, {
      params: { fileType: 'pointcloud' }
    })
    const base64 = res.data?.data?.base64Data
    if (!res.data?.success || !base64) throw new Error('下载失败')
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = map.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    
    ElMessage.success(`导出成功：${map.name}`)
  } catch (error) {
    console.error('导出失败:', error)
    ElMessage.error('导出失败')
  }
}

function handleDeleteMap(map: any) {
  deleteTargetMap.value = map
  deleteConfirmMessage.value = `确定要删除地图「${map.name}」吗？此操作不可恢复！`
  showDeleteConfirm.value = true
}

async function handleDeleteImportedMap(map: any) {
  deleteTargetMap.value = { ...map, type: 'imported' }
  deleteConfirmMessage.value = `确定要删除本地导入的地图「${map.name}」吗？此操作不可恢复！`
  showDeleteConfirm.value = true
}

async function handleUseGroupMap(map: any) {
  if (!map.pcdFileName) {
    ElMessage.warning('该分组没有PCD文件，无法使用')
    return
  }
  
  await handleUseMap({ name: map.mapName || map.name })
}

async function handleEditGroupMap(map: any) {
  if (!map.pcdFileName) {
    ElMessage.warning('该分组没有PCD文件，无法编辑')
    return
  }
  
  currentGroupId.value = map.groupId || ''
  await handleEditMap({ name: map.mapName || map.name })
}

async function handleDeleteGroupMap(map: any) {
  deleteTargetMap.value = { ...map, type: 'group' }
  deleteConfirmMessage.value = `确定要删除分组「${map.mapName || map.name}」及其所有文件吗？此操作不可恢复！`
  showDeleteConfirm.value = true
}

// ==================== 创建分组功能 ====================

function handleOpenCreateGroupDialog() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  createGroupForm.mapName = `map_${ts}`
  createGroupForm.dateTag = now.toISOString().slice(0, 10)
  groupFileList.value = []
  groupRawFiles.value = []
  if (groupUploadRef.value) {
    groupUploadRef.value.clearFiles()
  }
  showCreateGroupDialog.value = true
}

function resetCreateGroupForm() {
  createGroupForm.mapName = ''
  createGroupForm.dateTag = new Date().toISOString().slice(0, 10)
  groupFileList.value = []
  groupRawFiles.value = []
}

function handleGroupFileChange(uploadFile: any, uploadFiles: any[]) {
  groupFileList.value = uploadFiles
  groupRawFiles.value = uploadFiles.map((f: any) => f.raw).filter(Boolean)
}

function handleGroupFileRemove(_uploadFile: any, uploadFiles: any[]) {
  groupFileList.value = uploadFiles
  groupRawFiles.value = uploadFiles.map((f: any) => f.raw).filter(Boolean)
}

async function handleCreateGroup() {
  if (!createGroupForm.mapName.trim()) {
    ElMessage.error('请输入地图名称')
    return
  }

  creatingGroup.value = true
  try {
    const formData = new FormData()
    groupRawFiles.value.forEach(file => {
      formData.append('files', file, file.name)
    })
    formData.append('mapName', createGroupForm.mapName.trim())
    formData.append('dateTag', createGroupForm.dateTag)

    const createRes = await axios.post('/api/dispatch/agv/mapping/import/bundle', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000,
    })

    if (!createRes.data?.success) {
      throw new Error(createRes.data?.message || '创建分组失败')
    }

    ElMessage.success(`分组「${createGroupForm.mapName}」创建成功`)
    showCreateGroupDialog.value = false
    
    // 刷新分组列表
    await loadAllMaps()
    
    // 切换到分组标签页
    activeMapTab.value = 'group'
  } catch (error: any) {
    console.error('创建分组失败:', error)
    ElMessage.error(error?.response?.data?.message || error?.message || '创建分组失败')
  } finally {
    creatingGroup.value = false
  }
}

async function confirmDelete() {
  if (!deleteTargetMap.value) return
  
  try {
    const map = deleteTargetMap.value
    
    if (map.type === 'group' && map.groupId) {
      await axios.delete(`/api/dispatch/agv/mapping/pointcloud/groups/${map.groupId}`)
    } else {
      await axios.delete(`/api/dispatch/agv/mapping/import/delete/${encodeURIComponent(map.name)}`)
    }
    
    ElMessage.success(`已删除：${map.name || map.mapName}`)
    
    // 如果删除的是当前编辑的地图，清空编辑器
    if (editingMapName.value === (map.name || map.mapName)) {
      clearEditor()
    }
    
    await loadAllMaps()
  } catch (error) {
    console.error('删除失败:', error)
    ElMessage.error('删除失败')
  } finally {
    showDeleteConfirm.value = false
    deleteTargetMap.value = null
  }
}

async function openMapForEditing(name: string) {
  try {
    pcdFileLoader.loading.value = true
    pcdFileLoader.progress.value = 0
    pcdFileLoader.loadText.value = '正在加载地图...'

    const groupMatch = groupMaps.value.find(g => g.groupId === currentGroupId.value || (g.mapName || g.name) === name)

    // 分组模式：优先从分组目录加载 PCD/PGM/YAML
    if (groupMatch?.groupId) {
      currentGroupId.value = groupMatch.groupId
      editingMapName.value = groupMatch.mapName || name
      pcdFileLoader.initGroup(groupMatch.groupId, editingMapName.value, groupMatch.dateTag)
      if (groupMatch.pcdFileName) pcdFileLoader.markFileSaved('pointcloud', groupMatch.pcdFileName, groupMatch.pcdFileSize || 0)
      if (groupMatch.pgmFileName) pcdFileLoader.markFileSaved('occupancy', groupMatch.pgmFileName, groupMatch.pgmFileSize || 0)
      if (groupMatch.yamlFileName) pcdFileLoader.markFileSaved('yaml', groupMatch.yamlFileName, groupMatch.yamlFileSize || 0)

      if (!groupMatch.pcdFileName) {
        throw new Error('该分组没有 PCD 文件')
      }

      const pcdRes = await axios.get(`/api/dispatch/agv/mapping/pointcloud/download/${encodeURIComponent(groupMatch.groupId)}`, { params: { fileType: 'pointcloud' } })
      const pcdData = pcdRes.data?.data?.base64Data
      if (!pcdRes.data?.success || !pcdData) throw new Error('分组 PCD 文件加载失败')

      const pcdText = new TextDecoder('utf-8').decode(
        Uint8Array.from(atob(pcdData), c => c.charCodeAt(0))
      )
      await pcdFileLoader.parseFromString(pcdText, groupMatch.pcdFileName || `${editingMapName.value}.pcd`)

      if (pcdFileLoader.pcdMap.value) {
        brushEdit.initPointCloud(pcdFileLoader.pcdMap.value)
      }

      if (groupMatch.pgmFileName && groupMatch.yamlFileName) {
        try {
          const pgmRes = await axios.get(`/api/dispatch/agv/mapping/pointcloud/download/${encodeURIComponent(groupMatch.groupId)}`, { params: { fileType: 'occupancy' } })
          const yamlRes = await axios.get(`/api/dispatch/agv/mapping/pointcloud/download/${encodeURIComponent(groupMatch.groupId)}`, { params: { fileType: 'yaml' } })
          const pgmData = pgmRes.data?.data?.base64Data
          const yamlData = yamlRes.data?.data?.base64Data
          if (pgmRes.data?.success && yamlRes.data?.success && pgmData && yamlData) {
            const pgmBytes = Uint8Array.from(atob(pgmData), c => c.charCodeAt(0))
            const yamlText = new TextDecoder('utf-8').decode(
              Uint8Array.from(atob(yamlData), c => c.charCodeAt(0))
            )
            const pgmFile = new File([pgmBytes.buffer], groupMatch.pgmFileName)
            const yamlFile = new File([yamlText], groupMatch.yamlFileName || 'map.yaml')
            const { parseOccupancyGridFiles } = await import('@/utils/occupancyGrid')
            const gridMap = await parseOccupancyGridFiles(pgmFile, yamlFile)
            pcdFileLoader.occupancyGridMap.value = gridMap
            occupancyGrid.grid.value = gridMap
            occupancyGrid.invalidateCache()
          }
        } catch (e) {
          console.warn('加载分组栅格文件失败:', e)
        }
      } else {
        pcdFileLoader.occupancyGridMap.value = null
        occupancyGrid.grid.value = null
      }

      currentFileInfo.value = {
        name: groupMatch.pcdFileName,
        size: groupMatch.pcdFileSize || 0,
        groupId: groupMatch.groupId,
      }
      dirty.value = false
      nextTick(() => {
        threeScene?.render()
        fitViewToData()
        scheduleGridDraw()
      })
      ElMessage.success(`已打开分组地图：${editingMapName.value}`)
      return
    }

    const res = await axios.get(`/api/dispatch/agv/mapping/pointcloud/download/${encodeURIComponent(name)}`, { params: { fileType: 'pointcloud' } })

    if (res.data?.success && res.data?.data?.base64Data) {
      const pcdText = new TextDecoder('utf-8').decode(
        Uint8Array.from(atob(res.data.data.base64Data), c => c.charCodeAt(0))
      )
      // 解析PCD内容
      await pcdFileLoader.parseFromString(pcdText, name)

      // 初始化点云到场景
      if (pcdFileLoader.pcdMap.value) {
        console.log('[打开地图] 初始化点云, 点数:', pcdFileLoader.pcdMap.value.points.length)
        brushEdit.initPointCloud(pcdFileLoader.pcdMap.value)

        // 强制渲染
        nextTick(() => {
          threeScene?.render()
          fitViewToData()
        })
      }

      editingMapName.value = name

      // 尝试获取分组ID，并初始化分组元数据
      const groupMatch = groupMaps.value.find(g => (g.mapName || g.name) === name)
      if (groupMatch?.groupId) {
        currentGroupId.value = groupMatch.groupId
        // 初始化分组元数据（从服务器数据重建状态）
        pcdFileLoader.initGroup(groupMatch.groupId, name)
        if (groupMatch.pcdFileName) pcdFileLoader.markFileSaved('pointcloud', groupMatch.pcdFileName, groupMatch.pcdFileSize || 0)
        if (groupMatch.pgmFileName) pcdFileLoader.markFileSaved('occupancy', groupMatch.pgmFileName, groupMatch.pgmFileSize || 0)
        if (groupMatch.yamlFileName) pcdFileLoader.markFileSaved('yaml', groupMatch.yamlFileName, groupMatch.yamlFileSize || 0)

        // 尝试加载 PGM/YAML 栅格文件
        if (groupMatch.pgmFileName && groupMatch.yamlFileName) {
          try {
            const pgmRes = await axios.get(`/api/dispatch/agv/mapping/pointcloud/download/${encodeURIComponent(groupMatch.groupId)}`, { params: { fileType: 'occupancy' } })
            const yamlRes = await axios.get(`/api/dispatch/agv/mapping/pointcloud/download/${encodeURIComponent(groupMatch.groupId)}`, { params: { fileType: 'yaml' } })
            if (pgmRes.data?.success && yamlRes.data?.success) {
              const pgmData = pgmRes.data.data?.base64Data
              const yamlData = yamlRes.data.data?.base64Data
              if (pgmData && yamlData) {
                const pgmBytes = Uint8Array.from(atob(pgmData), c => c.charCodeAt(0))
                const yamlText = new TextDecoder('utf-8').decode(
                  Uint8Array.from(atob(yamlData), c => c.charCodeAt(0))
                )
                const pgmFile = new File([pgmBytes.buffer], groupMatch.pgmFileName)
                const yamlFile = new File([yamlText], groupMatch.yamlFileName || 'map.yaml')
                // 解析栅格地图
                const { parseOccupancyGridFiles } = await import('@/utils/occupancyGrid')
                const gridMap = await parseOccupancyGridFiles(pgmFile, yamlFile)
                pcdFileLoader.occupancyGridMap.value = gridMap
                occupancyGrid.grid.value = gridMap
                occupancyGrid.invalidateCache()
                nextTick(() => scheduleGridDraw())
              }
            }
          } catch (e) {
            console.warn('加载栅格文件失败:', e)
          }
        }
      }

      // 更新文件信息
      currentFileInfo.value = res.data.data
      dirty.value = false

      // 适配视图
      nextTick(() => {
        fitViewToData()
      })

      ElMessage.success(`已打开：${name}`)
    } else {
      throw new Error('无效的响应数据')
    }
  } catch (error) {
    console.error('打开地图失败:', error)
    ElMessage.error('打开地图失败')
  } finally {
    pcdFileLoader.loading.value = false
  }
}

async function loadCurrentGroupFiles() {
  if (!currentGroupId.value) return
  
  try {
    const res = await axios.get(`/api/dispatch/agv/mapping/pointcloud/groups/${encodeURIComponent(currentGroupId.value)}`)
    if (res.data?.success && res.data?.data) {
      const files = res.data.data.files || []
      const pgm = files.find((f: any) => f.fileType === 'occupancy')
      const yaml = files.find((f: any) => f.fileType === 'yaml')
      hasPgmFile.value = !!pgm
      hasYamlFile.value = !!yaml
      if (pgm?.fileSize) pgmFileSize.value = pgm.fileSize
      if (yaml?.fileSize) yamlFileSize.value = yaml.fileSize
    }
  } catch (error) {
    console.warn('加载分组文件状态失败:', error)
  }
}

// ==================== 编辑器操作方法 ====================

function fitViewToData() {
  brushEdit.fitToView()
  renderAllLayers()
}

function zoomIn() {
  cameraZoom.value = Math.min(cameraZoom.value * 1.15, 100)
  mouseControls?.updateCameraView()
  renderAllLayers()
}

function zoomOut() {
  cameraZoom.value = Math.max(cameraZoom.value / 1.15, 0.05)
  mouseControls?.updateCameraView()
  renderAllLayers()
}

function resetView() {
  const camera = threeScene?.getCamera() as THREE.OrthographicCamera | undefined
  if (camera) camera.position.set(0, 0, camera.position.z)
  cameraPosition.value.set(0, 0, 100)
  cameraZoom.value = 1
  mouseControls?.updateCameraView()
  renderAllLayers()
}

async function handleSaveCommand(command: string) {
  if (!editingMapName.value) {
    ElMessage.warning('没有正在编辑的地图')
    return
  }
  
  if (command === 'save') {
    await saveCurrentMap()
  } else if (command === 'saveAs') {
    // TODO: 实现另存为功能
    ElMessage.info('另存为功能开发中...')
  }
}

async function saveCurrentMap() {
  if (!editingMapName.value) return
  
  try {
    const safeName = editingMapName.value.replace(/\s/g, '_').replace(/\.pcd$/i, '')
    const files: File[] = []

    const pcdContent = brushEdit.exportToString()
    const pcdBlob = new Blob([pcdContent], { type: 'application/octet-stream' })
    files.push(new File([pcdBlob], `${safeName}.pcd`, { type: 'application/octet-stream' }))

    const serialized = occupancyGrid.getSerializedFiles(editingMapName.value)
    if (serialized) {
      files.push(new File([serialized.pgmBlob], `${safeName}.pgm`, { type: 'application/octet-stream' }))
      files.push(new File([serialized.yamlText], `${safeName}.yaml`, { type: 'text/yaml' }))
    }

    for (const file of files) {
      const formData = new FormData()
      formData.append('file', file, file.name)
      const ext = file.name.toLowerCase().split('.').pop()
      formData.append('fileType', ext === 'pcd' ? 'pointcloud' : ext === 'pgm' ? 'occupancy' : 'yaml')
      const res = await axios.post(`/api/dispatch/agv/mapping/import/save/${encodeURIComponent(safeName)}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000,
      })
      if (!res.data?.success) throw new Error(res.data?.message || '保存失败')
    }

    dirty.value = false
    hasPgmFile.value = !!files[1]
    hasYamlFile.value = !!files[2]
    if (files[1]) pgmFileSize.value = files[1].size
    if (files[2]) yamlFileSize.value = files[2].size
    await loadAllMaps()
    ElMessage.success(`已保存到本地 pcd 文件夹：${safeName}`)
  } catch (error: any) {
    console.error('保存失败:', error)
    ElMessage.error(error?.message || '保存失败')
  }
}

function clearEditor() {
  editingMapName.value = ''
  currentGroupId.value = ''
  currentFileInfo.value = null
  dirty.value = false
  hasPgmFile.value = false
  hasYamlFile.value = false
  // 清空点云数据
  brushEdit.clearAll()
}

function onToggleGridDisplay(value: boolean) {
  if (value) {
    occupancyGrid.showGridDisplay()
  } else {
    occupancyGrid.hideGridDisplay()
  }
}

// ==================== Three.js 场景初始化 ====================

function initThreeJS() {
  if (!canvasContainer.value) return

  threeScene = useThreeScene({
    container: canvasContainer,
    cameraZoom,
    cameraPosition,
    initialCameraZoom: 1,
    baseViewSize,
    sceneBackground: 0xf5f7fa,
    mouseHandlers: {
      handleWheel: () => {},
      handleMouseDown: () => {},
      handleContextMenu: () => {}
    }
  })

  // 初始化场景（创建 scene、camera、renderer）
  const initResult = threeScene.initScene()
  console.log('[Three.js] 场景初始化结果:', initResult)

  mouseControls = useThreeMouseControls({
    getCamera: () => threeScene?.getCamera() as any,
    getRenderer: () => threeScene?.getRenderer() as any,
    getContainer: () => canvasContainer.value!,
    cameraZoom,
    cameraPosition,
    render: () => renderAllLayers(),
    updateCameraView: () => {
      threeScene?.updateCameraView()
      scheduleGridDraw()
    }
  })

  // 在 renderer canvas 上重新绑定正确的事件处理器（覆盖 useThreeScene 中的空函数）
  const renderer = threeScene?.getRenderer()
  if (renderer && mouseControls) {
    // 移除旧的空 handler，绑定真实的 mouseControls
    const canvas = renderer.domElement
    canvas.onwheel = null
    canvas.addEventListener('wheel', (e) => mouseControls!.handleWheel(e), { passive: false })
    canvas.addEventListener('contextmenu', (e) => mouseControls!.handleContextMenu(e))
  }

  // 在 window 上绑定 mousemove/mouseup，确保拖拽时鼠标移出画布也能正常工作
  window.addEventListener('mousemove', mouseControls?.handleGlobalMouseMove || onCanvasMouseMove)
  window.addEventListener('mouseup', onCanvasMouseUp)

  console.log('Three.js scene initialized')
}

// ==================== 生命周期 ====================

onMounted(async () => {
  initThreeJS()
  await loadAllMaps()
})

onUnmounted(() => {
  window.removeEventListener('mousemove', mouseControls?.handleGlobalMouseMove || onCanvasMouseMove)
  window.removeEventListener('mouseup', onCanvasMouseUp)
  threeScene?.dispose()
})
</script>

<style scoped>
/* ==================== 全局样式 ==================== */
.pcd-editor-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background:
    radial-gradient(circle at 12% 10%, rgba(59, 130, 246, 0.16), transparent 30%),
    radial-gradient(circle at 88% 12%, rgba(168, 85, 247, 0.14), transparent 28%),
    linear-gradient(135deg, #eef4ff 0%, #f8fafc 46%, #edf2f7 100%);
  overflow: hidden;
  --ui-radius: 12px;
  --ui-radius-sm: 9px;
  --ui-radius-xs: 7px;
  --ui-border: rgba(148, 163, 184, 0.22);
  --ui-border-strong: rgba(99, 102, 241, 0.22);
  --ui-shadow: 0 14px 36px rgba(15, 23, 42, 0.10);
  --ui-shadow-soft: 0 8px 22px rgba(15, 23, 42, 0.06);
  --ui-card: rgba(255, 255, 255, 0.86);
  --ui-card-solid: #ffffff;
  --ui-text: #111827;
  --ui-muted: #64748b;
  --ui-primary: #2563eb;
  --ui-primary-dark: #1d4ed8;
}

.pcd-editor-app :deep(.el-button),
.pcd-editor-app :deep(.el-input__wrapper),
.pcd-editor-app :deep(.el-input-number),
.pcd-editor-app :deep(.el-dialog),
.pcd-editor-app :deep(.el-upload-dragger),
.pcd-editor-app :deep(.el-tag) {
  border-radius: var(--ui-radius-sm);
}

.pcd-editor-app :deep(.el-button) {
  font-weight: 600;
  letter-spacing: 0.2px;
  border-color: rgba(148, 163, 184, 0.32);
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.04);
}

.pcd-editor-app :deep(.el-button--primary) {
  background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);
  border: none;
}

.pcd-editor-app :deep(.el-button--success) {
  background: linear-gradient(135deg, #059669 0%, #10b981 100%);
  border: none;
}

.pcd-editor-app :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.26) inset;
}

.pcd-editor-app :deep(.el-dialog) {
  overflow: hidden;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.20);
}

.pcd-editor-app :deep(.el-radio-button:first-child .el-radio-button__inner) {
  border-radius: var(--ui-radius-sm) 0 0 var(--ui-radius-sm);
}

.pcd-editor-app :deep(.el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 0 var(--ui-radius-sm) var(--ui-radius-sm) 0;
}

.pcd-editor-app :deep(.el-radio-button__inner) {
  font-weight: 700;
  color: #475569;
  background: rgba(255,255,255,0.86);
  border-color: rgba(148, 163, 184, 0.24);
}

.pcd-editor-app :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);
  border-color: transparent;
  box-shadow: 0 7px 18px rgba(37, 99, 235, 0.24);
}

/* ==================== 顶部工具栏 ==================== */
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 12px 14px 0;
  padding: 14px 18px;
  background:
    linear-gradient(135deg, rgba(15, 23, 42, 0.96) 0%, rgba(30, 41, 59, 0.94) 58%, rgba(37, 99, 235, 0.90) 100%);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: var(--ui-radius);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.20);
  z-index: 10;
  backdrop-filter: blur(14px);
}

.header-left .map-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.4px;
  background: linear-gradient(90deg, #ffffff, #dbeafe);
  -webkit-background-clip: text;
  color: transparent;
}

.header-right {
  display: flex;
  gap: 10px;
}

/* ==================== 主内容区域 ==================== */
.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
  padding: 12px 14px 14px;
  gap: 12px;
}

/* ==================== 左侧地图列表面板 ==================== */
.map-list-panel {
  width: 480px;
  min-width: 440px;
  background: var(--ui-card);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  display: flex;
  flex-direction: column;
  box-shadow: var(--ui-shadow);
  backdrop-filter: blur(16px);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid var(--ui-border);
  background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,250,252,0.74));
}

.panel-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--ui-text);
  letter-spacing: 0.2px;
}

.panel-actions {
  display: flex;
  gap: 6px;
}

.map-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.map-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 10px 12px 0;
  background: rgba(248, 250, 252, 0.65);
}

.map-tabs :deep(.el-tabs__item) {
  height: 34px;
  border-radius: var(--ui-radius-sm) var(--ui-radius-sm) 0 0;
  font-weight: 700;
}

.map-tabs :deep(.el-tabs__item.is-active) {
  color: var(--ui-primary);
}

.map-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.tab-actions {
  display: flex;
  justify-content: flex-end;
  padding: 8px 12px;
  background: #fafafa;
  border-bottom: 1px solid #ebeef5;
}

.map-table-wrapper {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

.map-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 10px;
  font-size: 13px;
}

.map-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  color: #64748b;
  border-bottom: 1px solid var(--ui-border);
  z-index: 1;
  white-space: nowrap;
}

.map-table td {
  padding: 14px 12px;
  border-top: 1px solid rgba(226, 232, 240, 0.86);
  border-bottom: 1px solid rgba(226, 232, 240, 0.86);
  vertical-align: middle;
  background: rgba(255, 255, 255, 0.88);
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}

.map-table td:first-child {
  border-left: 1px solid #edf2f7;
  border-radius: var(--ui-radius-sm) 0 0 var(--ui-radius-sm);
}

.map-table td:last-child {
  border-right: 1px solid #edf2f7;
  border-radius: 0 var(--ui-radius-sm) var(--ui-radius-sm) 0;
}

.map-table tr:hover td {
  background-color: #f8fbff;
}

.map-table tr.active td {
  background-color: #eff6ff;
  border-color: #bfdbfe;
}

.info-cell {
  position: relative;
  overflow: hidden;
}

.info-content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
  padding-bottom: 4px;
}

.info-content-wrapper::-webkit-scrollbar {
  height: 4px;
}

.info-content-wrapper::-webkit-scrollbar-thumb {
  background-color: #cbd5e1;
  border-radius: 2px;
}

.info-main-row {
  display: flex;
  align-items: center;
  gap: 20px;
  white-space: nowrap;
  min-width: max-content;
}

.name-cell {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  min-width: 120px;
  max-width: 200px;
}

.local-name-cell {
  min-width: 160px;
  max-width: 240px;
}

.local-map-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #94a3b8;
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}

.size-cell,
.point-cell {
  color: #475569;
  font-weight: 500;
  white-space: nowrap;
}

.size-text,
.point-text {
  color: #475569;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.point-cell,
.point-text {
  color: #2563eb;
}

.local-action-cell {
  width: 180px;
  vertical-align: top !important;
}

.group-action-cell {
  width: 140px;
  vertical-align: top !important;
}

.map-name {
  font-weight: 600;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
  flex-shrink: 0;
}

.action-cell {
  text-align: right;
  width: auto;
  min-width: 120px;
  vertical-align: middle !important;
}

.action-buttons-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  justify-items: end;
}

.action-buttons-grid.local-buttons {
  grid-template-columns: repeat(2, 1fr);
  justify-items: stretch;
}

.action-buttons-grid .el-button:nth-child(3) {
  grid-column: 1 / -1;
  width: 100%;
  max-width: 90px;
  justify-self: center;
}

.action-cell :deep(.el-button) {
  margin-left: 0 !important;
  padding: 6px 12px;
  font-size: 12px;
}

.local-buttons :deep(.el-button) {
  width: 100%;
  justify-content: center;
}

.file-tags-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 145px;
}

.group-info-cell {
  position: relative;
  overflow: hidden;
}

.file-tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 6px;
  min-width: max-content;
}

.file-tag {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.4;
  background: #f1f5f9;
  color: #94a3b8;
  border: 1px solid #e2e8f0;
  white-space: nowrap;
}

.file-tag.active {
  background: #ecfdf5;
  color: #059669;
  border-color: #a7f3d0;
}

.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

/* ==================== 中间编辑器画布区域 ==================== */
.editor-canvas-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.34);
  padding: 0;
  gap: 12px;
}

.canvas-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  background: var(--ui-card);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  gap: 12px;
  flex-wrap: nowrap;
  box-shadow: var(--ui-shadow-soft);
  backdrop-filter: blur(16px);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: nowrap;
}

.toolbar-right {
  display: flex;
  gap: 8px;
}

.param-label {
  font-size: 13px;
  color: #606266;
  font-weight: 500;
}

.param-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
}

.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(241, 245, 249, 0.92));
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), var(--ui-shadow-soft);
}

.canvas-container :deep(canvas:not(.grid-canvas)) {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: block;
}

.grid-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
}

.empty-canvas-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 5;
}

.loading-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.95);
  padding: 24px 32px;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.loading-text {
  font-size: 14px;
  color: #606266;
}

.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  background: var(--ui-card);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  font-size: 12px;
  color: var(--ui-muted);
  box-shadow: var(--ui-shadow-soft);
  backdrop-filter: blur(16px);
}

.status-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.stat-label {
  color: #909399;
}

.stat-value {
  color: #303133;
  font-weight: 500;
}

.stat-separator {
  color: #dcdfe6;
}

/* ==================== 右侧属性面板 ==================== */
.property-panel {
  width: 300px;
  min-width: 280px;
  background: var(--ui-card);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  overflow-y: auto;
  box-shadow: var(--ui-shadow);
  backdrop-filter: blur(16px);
}

.property-panel :deep(.el-collapse) {
  border: none;
  background: transparent;
}

.property-panel :deep(.el-collapse-item__header) {
  font-weight: 800;
  font-size: 14px;
  color: var(--ui-text);
  background: transparent;
  padding: 0 14px;
  border-bottom-color: rgba(226, 232, 240, 0.7);
}

.info-section {
  padding: 8px 0;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13px;
}

.info-label {
  color: #909399;
}

.info-value {
  color: #303133;
  font-weight: 500;
}

.group-info-card {
  background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,250,252,0.88));
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: var(--ui-radius-sm);
  padding: 12px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 800;
  margin-bottom: 12px;
  color: var(--ui-primary);
}

.group-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.detail-label {
  color: #909399;
  min-width: 56px;
}

.detail-value {
  color: #303133;
  flex: 1;
}

.group-files-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #eee;
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #c0c4cc;
  flex-shrink: 0;
}

.file-status-item.active .status-dot {
  background-color: #67c23a;
}

.file-status-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  opacity: 0.5;
}

.file-status-item.active {
  opacity: 1;
}

.reload-btn {
  width: 100%;
  margin-top: 12px;
}

.grid-control {
  padding: 12px 0;
}

/* ==================== 导入对话框样式 ==================== */
.selected-files-summary {
  font-size: 13px;
  color: #606266;
  margin-bottom: 8px;
}

.upload-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.selected-files-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 150px;
  overflow-y: auto;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
}

.selected-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 13px;
}

.selected-file-item:last-child {
  border-bottom: none;
}

.file-name {
  flex: 1;
  color: #303133;
}

.file-size {
  color: #909399;
  min-width: 60px;
  text-align: right;
}

/* ==================== 响应式设计 ==================== */
@media (max-width: 1200px) {
  .map-list-panel {
    width: 400px;
    min-width: 380px;
  }

  .property-panel {
    width: 260px;
    min-width: 240px;
  }

  .local-action-cell {
    width: 160px;
  }

  .group-action-cell {
    width: 130px;
  }
}

@media (max-width: 992px) {
  .property-panel {
    display: none;
  }
}
</style>
