import { ref, computed } from 'vue'
import { parsePcdFile, parsePcdFromString, type PcdMap, type PcdParseProgress } from '@/utils/pcd'
import { parseOccupancyGridFiles, type OccupancyGridMap } from '@/utils/occupancyGrid'

type MapFileExt = 'pcd' | 'pgm' | 'yaml'
type MapFileContent = { name: string; ext: MapFileExt; file: File }

/** 分组文件状态 */
export type FileStatus = 'loaded' | 'modified' | 'saved' | 'missing'

/** 分组文件项 */
export interface FileGroupItem {
  fileName: string
  fileSize: number
  status: FileStatus
  lastModified: string
}

/** 文件分组元数据 */
export interface MapFileGroup {
  groupId: string
  mapName: string
  dateTag?: string
  createdAt: string
  updatedAt: string
  files: {
    pointcloud: FileGroupItem
    occupancy: FileGroupItem
    yaml: FileGroupItem
  }
}

export function usePcdFileLoader() {
  const pcdMap = ref<PcdMap | null>(null)
  const occupancyGridMap = ref<OccupancyGridMap | null>(null)
  const loading = ref(false)
  const progress = ref(0)
  const loadText = ref('')
  const fileName = ref('')

  // 分组状态
  const groupId = ref<string | null>(null)
  const groupMeta = ref<MapFileGroup | null>(null)

  /** 分组是否完整（三文件齐全已保存） */
  const isGroupComplete = computed(() => {
    if (!groupMeta.value) return false
    const f = groupMeta.value.files
    return [f.pointcloud, f.occupancy, f.yaml].every(item => item.status === 'saved')
  })

  /** 获取缺失的文件类型列表 */
  const getMissingFileTypes = computed(() => {
    if (!groupMeta.value) return []
    const types: string[] = []
    const f = groupMeta.value.files
    if (f.pointcloud.status === 'missing') types.push('pointcloud')
    if (f.occupancy.status === 'missing') types.push('occupancy')
    if (f.yaml.status === 'missing') types.push('yaml')
    return types
  })

  /** 初始化分组 */
  function initGroup(newGroupId: string, mapName: string, dateTag?: string) {
    groupId.value = newGroupId
    groupMeta.value = {
      groupId: newGroupId,
      mapName,
      dateTag: dateTag || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      files: {
        pointcloud: { fileName: '', fileSize: 0, status: 'missing', lastModified: '' },
        occupancy: { fileName: '', fileSize: 0, status: 'missing', lastModified: '' },
        yaml: { fileName: '', fileSize: 0, status: 'missing', lastModified: '' },
      }
    }
  }

  /** 从后端加载分组元数据 */
  function loadGroupMeta(meta: MapFileGroup) {
    groupId.value = meta.groupId
    groupMeta.value = meta
  }

  /** 获取某类型文件状态 */
  function getFileStatus(fileType: 'pointcloud' | 'occupancy' | 'yaml'): FileStatus {
    return groupMeta.value?.files[fileType]?.status ?? 'missing'
  }

  /** 标记文件已保存 */
  function markFileSaved(fileType: 'pointcloud' | 'occupancy' | 'yaml', savedFileName?: string, fileSize?: number) {
    if (!groupMeta.value) return
    groupMeta.value.files[fileType] = {
      fileName: savedFileName ?? groupMeta.value.files[fileType].fileName,
      fileSize: fileSize ?? groupMeta.value.files[fileType].fileSize,
      status: 'saved',
      lastModified: new Date().toISOString()
    }
    groupMeta.value.updatedAt = new Date().toISOString()
  }

  /** 标记文件已加载（本地有数据，未同步到服务器） */
  function markFileLoaded(fileType: 'pointcloud' | 'occupancy' | 'yaml', loadedFileName?: string, fileSize?: number) {
    if (!groupMeta.value) return
    groupMeta.value.files[fileType] = {
      fileName: loadedFileName ?? groupMeta.value.files[fileType].fileName,
      fileSize: fileSize ?? groupMeta.value.files[fileType].fileSize,
      status: 'loaded',
      lastModified: new Date().toISOString()
    }
    groupMeta.value.updatedAt = new Date().toISOString()
  }

  /** 标记文件已修改 */
  function markFileModified(fileType: 'pointcloud' | 'occupancy' | 'yaml') {
    if (!groupMeta.value) return
    const item = groupMeta.value.files[fileType]
    if (item.status !== 'missing') {
      item.status = 'modified'
      item.lastModified = new Date().toISOString()
      groupMeta.value.updatedAt = new Date().toISOString()
    }
  }

  /** 判断所有已加载文件是否都已保存 */
  function areAllSaved(): boolean {
    if (!groupMeta.value) return false
    const f = groupMeta.value.files
    return [f.pointcloud, f.occupancy, f.yaml].every(
      item => item.status === 'missing' || item.status === 'saved'
    )
  }

  function mapFileExt(name: string): MapFileExt | null {
    const lower = name.toLowerCase()
    if (lower.endsWith('.pcd')) return 'pcd'
    if (lower.endsWith('.pgm')) return 'pgm'
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
    return null
  }

  function filesToMapContents(files: File[]) {
    return files.map((file) => {
      const ext = mapFileExt(file.name)
      if (!ext) throw new Error(`不支持的地图文件: ${file.name}`)
      return { name: file.name, ext, file }
    })
  }

  function validateMapFileSelection(files: MapFileContent[]) {
    if (!files.length) throw new Error('请选择 .pcd / .pgm / .yaml 文件')
    const groups: Record<MapFileExt, MapFileContent[]> = { pcd: [], pgm: [], yaml: [] }
    for (const file of files) groups[file.ext].push(file)
    for (const ext of Object.keys(groups) as MapFileExt[]) {
      if (groups[ext].length > 1) throw new Error(`只能选择一个 .${ext === 'yaml' ? 'yaml/.yml' : ext} 文件`)
    }
    if (groups.pgm.length !== groups.yaml.length) throw new Error('map.pgm 和 map.yaml 必须同时选择')
    if (!groups.pcd.length && !(groups.pgm.length && groups.yaml.length)) {
      throw new Error('至少选择 PCD，或者同时选择 PGM + YAML')
    }
    return { pcd: groups.pcd[0], pgm: groups.pgm[0], yaml: groups.yaml[0] }
  }

  async function loadLocalFiles(files: File[]) {
    loading.value = true
    progress.value = 0
    loadText.value = '正在校验地图文件'
    try {
      const contents = filesToMapContents(files)
      const selection = validateMapFileSelection(contents)

      // 更新分组中文件状态
      if (groupMeta.value) {
        if (selection.pcd) {
          groupMeta.value.files.pointcloud = {
            fileName: selection.pcd.name,
            fileSize: selection.pcd.file.size,
            status: 'loaded',
            lastModified: new Date().toISOString()
          }
        }
        if (selection.pgm && selection.yaml) {
          groupMeta.value.files.occupancy = {
            fileName: selection.pgm.name,
            fileSize: selection.pgm.file.size,
            status: 'loaded',
            lastModified: new Date().toISOString()
          }
          groupMeta.value.files.yaml = {
            fileName: selection.yaml.name,
            fileSize: selection.yaml.file.size,
            status: 'loaded',
            lastModified: new Date().toISOString()
          }
        }
      }

      if (selection.pgm && selection.yaml) {
        loadText.value = '正在解析栅格地图'
        progress.value = 20
        occupancyGridMap.value = await parseOccupancyGridFiles(selection.pgm.file, selection.yaml.file)
      } else {
        occupancyGridMap.value = null
      }

      if (!selection.pcd) {
        progress.value = 100
        loadText.value = '栅格地图加载完成'
        loading.value = false
        return
      }

      loadText.value = '正在读取并解析 PCD'
      progress.value = 30
      const parsed = await parsePcdFile(selection.pcd.file, (p: PcdParseProgress) => {
        if (p.phase === 'read') progress.value = 30 + p.progress * 0.4
        else if (p.phase === 'header') progress.value = 70
        else if (p.phase === 'parse') progress.value = 70 + p.progress * 0.2
        else if (p.phase === 'done') progress.value = 95
      })
      pcdMap.value = parsed
      fileName.value = selection.pcd.name
      progress.value = 100
      loadText.value = '加载完成'

    } catch (err) {
      pcdMap.value = null
      fileName.value = ''
      throw err
    } finally {
      loading.value = false
    }
  }

  function loadFromPcdMap(map: PcdMap, name: string) {
    pcdMap.value = map
    fileName.value = name
  }

  async function parseFromString(content: string, name: string) {
    loading.value = true
    progress.value = 0
    loadText.value = '正在解析PCD内容...'
    try {
      const parsed = await parsePcdFromString(content, (p: PcdParseProgress) => {
        if (p.phase === 'read') progress.value = 30 + p.progress * 0.4
        else if (p.phase === 'header') progress.value = 70
        else if (p.phase === 'parse') progress.value = 70 + p.progress * 0.2
        else if (p.phase === 'done') progress.value = 95
      })
      pcdMap.value = parsed
      fileName.value = name
      progress.value = 100
      loadText.value = '加载完成'
    } catch (err) {
      pcdMap.value = null
      fileName.value = ''
      throw err
    } finally {
      loading.value = false
    }
  }

  function setOccupancyGrid(map: OccupancyGridMap | null) {
    occupancyGridMap.value = map
  }

  function reset() {
    pcdMap.value = null
    occupancyGridMap.value = null
    loading.value = false
    progress.value = 0
    loadText.value = ''
    fileName.value = ''
    groupId.value = null
    groupMeta.value = null
  }

  return {
    pcdMap,
    occupancyGridMap,
    loading,
    progress,
    loadText,
    fileName,
    groupId,
    groupMeta,
    isGroupComplete,
    getMissingFileTypes,
    initGroup,
    loadGroupMeta,
    getFileStatus,
    markFileSaved,
    markFileLoaded,
    markFileModified,
    areAllSaved,
    loadLocalFiles,
    loadFromPcdMap,
    parseFromString,
    setOccupancyGrid,
    reset,
  }
}
