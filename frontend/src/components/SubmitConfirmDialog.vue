<template>
  <el-dialog
    v-model="visible"
    title="提交到服务器"
    width="480px"
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
  >
    <div class="submit-dialog-body">
      <p class="submit-desc">将把以下文件提交到服务器：</p>

      <div class="submit-info">
        <div class="submit-info-row">
          <span class="info-label">地图名称:</span>
          <span class="info-value">{{ mapName }}</span>
        </div>
        <div class="submit-info-row">
          <span class="info-label">分组ID:</span>
          <span class="info-value mono">{{ groupIdShort }}</span>
        </div>
      </div>

      <div class="submit-files">
        <div
          v-for="item in fileCheckList"
          :key="item.type"
          class="submit-file-item"
        >
          <el-checkbox
            v-model="item.checked"
            :disabled="item.status === 'missing' || submitting"
            :label="`${item.label} (${formatSize(item.size)})`"
          />
          <span v-if="item.result === 'success'" class="result-icon success">✅</span>
          <span v-else-if="item.result === 'fail'" class="result-icon fail">❌</span>
        </div>
      </div>

      <div v-if="progress > 0" class="submit-progress">
        <el-progress :percentage="Math.round((progress / total) * 100)" :text-inside="true" />
        <span class="progress-text">{{ progressText }}</span>
      </div>

      <div v-if="submitResult" class="submit-result" :class="submitResult">
        {{ resultMessage }}
      </div>
    </div>

    <template #footer>
      <el-button @click="handleCancel" :disabled="submitting">取消</el-button>
      <el-button
        type="primary"
        @click="handleConfirm"
        :loading="submitting"
        :disabled="!hasCheckedFiles"
      >
        {{ submitting ? '提交中...' : '确认提交' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { MapFileGroup } from '@/composables/usePcdFileLoader'

const props = defineProps<{
  modelValue: boolean
  groupMeta: MapFileGroup | null
  submitting?: boolean
  progress?: number
  total?: number
  progressText?: string
  submitResult?: 'success' | 'partial' | 'fail' | ''
  resultMessage?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [types: string[]]
  cancel: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const fileCheckList = ref<Array<{ type: string; label: string; size: number; status: string; checked: boolean; result: string }>>([])

watch(() => props.groupMeta, (meta) => {
  if (!meta || !meta.files) { fileCheckList.value = []; return }
  const f = meta.files
  fileCheckList.value = [
    { type: 'pointcloud', label: 'PCD 点云', size: f.pointcloud?.fileSize ?? 0, status: f.pointcloud?.status ?? 'missing', checked: f.pointcloud?.status !== 'missing', result: '' },
    { type: 'occupancy', label: 'PGM 栅格', size: f.occupancy?.fileSize ?? 0, status: f.occupancy?.status ?? 'missing', checked: f.occupancy?.status !== 'missing', result: '' },
    { type: 'yaml', label: 'YAML 配置', size: f.yaml?.fileSize ?? 0, status: f.yaml?.status ?? 'missing', checked: f.yaml?.status !== 'missing', result: '' },
  ]
}, { immediate: true })

const mapName = computed(() => props.groupMeta?.mapName ?? '')
const groupIdShort = computed(() => {
  const id = props.groupMeta?.groupId
  if (!id) return ''
  return id.length > 20 ? id.substring(0, 8) + '...' + id.substring(id.length - 8) : id
})
const hasCheckedFiles = computed(() => fileCheckList.value.some(f => f.checked))

function formatSize(bytes: number): string {
  if (bytes === 0) return '0B'
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1024 / 1024).toFixed(1) + 'MB'
}

function handleConfirm() {
  const types = fileCheckList.value.filter(f => f.checked).map(f => f.type)
  emit('confirm', types)
}

function handleCancel() {
  if (props.submitting) return
  emit('cancel')
}
</script>

<style scoped>
.submit-dialog-body {
  font-size: 14px;
}

.submit-desc {
  color: #606266;
  margin: 0 0 12px;
}

.submit-info {
  background: #f5f7fa;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
}

.submit-info-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 22px;
}

.info-label {
  color: #909399;
}

.info-value {
  color: #303133;
}

.info-value.mono {
  font-family: monospace;
  font-size: 11px;
}

.submit-files {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.submit-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.result-icon {
  font-size: 14px;
}

.submit-progress {
  margin-bottom: 8px;
}

.progress-text {
  display: block;
  text-align: center;
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.submit-result {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

.submit-result.success {
  background: rgba(103, 194, 58, 0.1);
  color: #67c23a;
}

.submit-result.partial {
  background: rgba(230, 162, 60, 0.1);
  color: #e6a23c;
}

.submit-result.fail {
  background: rgba(245, 108, 108, 0.1);
  color: #f56c6c;
}
</style>
