import { type Ref } from 'vue'
import * as THREE from 'three'

/**
 * Three.js 鼠标控制组合式函数
 * 用于处理 3D 场景中的鼠标交互：平移、旋转、缩放
 * 基于原始 map-editor 项目的成熟实现
 */
export const useThreeMouseControls = (params: {
  getCamera: () => THREE.OrthographicCamera | null
  getRenderer: () => THREE.WebGLRenderer | null
  getContainer: () => HTMLElement | null
  cameraZoom: Ref<number>
  cameraPosition: Ref<THREE.Vector3>
  render: () => void
  updateCameraView: () => void
}) => {
  // 鼠标事件状态
  let isPanning = false
  let panStartX = 0
  let panStartY = 0
  let panStartCameraX = 0
  let panStartCameraY = 0
  let panRAF = 0
  
  /**
   * 鼠标按下事件 - 开始平移
   */
  const handleMouseDown = (e: MouseEvent) => {
    const renderer = params.getRenderer()
    const camera = params.getCamera()
    if (!renderer || !camera) return
    
    if (e.button === 0 || e.button === 2) {
      e.preventDefault()
      isPanning = true
      panStartX = e.clientX
      panStartY = e.clientY
      panStartCameraX = camera.position.x
      panStartCameraY = camera.position.y
      renderer.domElement.style.cursor = 'grabbing'
    }
  }
  
  /**
   * 触摸开始事件（手机端单指拖拽移动画布）
   */
  const handleTouchStart = (e: TouchEvent) => {
    const renderer = params.getRenderer()
    const camera = params.getCamera()
    if (!renderer || !camera) return
    
    if (e.touches.length === 1) {
      e.preventDefault()
      isPanning = true
      const touch = e.touches[0]
      panStartX = touch.clientX
      panStartY = touch.clientY
      panStartCameraX = camera.position.x
      panStartCameraY = camera.position.y
    }
  }
  
  /**
   * 鼠标移动事件 - 处理平移操作
   */
  const handleMouseMove = (e: MouseEvent) => {
    const renderer = params.getRenderer()
    const camera = params.getCamera()
    if (!renderer || !camera) return
    
    if (isPanning) {
      const deltaX = e.clientX - panStartX
      const deltaY = e.clientY - panStartY
      
      const rect = renderer.domElement.getBoundingClientRect()
      const worldDeltaX = (deltaX / rect.width) * (camera.right - camera.left)
      const worldDeltaY = -(deltaY / rect.height) * (camera.top - camera.bottom)
      
      camera.position.x = panStartCameraX - worldDeltaX
      camera.position.y = panStartCameraY - worldDeltaY

      if (!panRAF) {
        panRAF = requestAnimationFrame(() => {
          panRAF = 0
          params.render()
        })
      }
    }
  }

  /**
   * 全局 mousemove（用于拖拽时鼠标移出画布）
   */
  const handleGlobalMouseMove = (e: MouseEvent) => {
    if (isPanning) {
      handleMouseMove(e)
    }
  }
  
  /**
   * 触摸移动事件
   */
  const handleTouchMove = (e: TouchEvent) => {
    const renderer = params.getRenderer()
    const camera = params.getCamera()
    if (!renderer || !camera) return
    
    if (isPanning && e.touches.length === 1) {
      e.preventDefault()
      const touch = e.touches[0]
      const deltaX = touch.clientX - panStartX
      const deltaY = touch.clientY - panStartY
      
      const rect = renderer.domElement.getBoundingClientRect()
      const worldDeltaX = (deltaX / rect.width) * (camera.right - camera.left)
      const worldDeltaY = -(deltaY / rect.height) * (camera.top - camera.bottom)
      
      camera.position.x = panStartCameraX - worldDeltaX
      camera.position.y = panStartCameraY - worldDeltaY

      if (!panRAF) {
        panRAF = requestAnimationFrame(() => {
          panRAF = 0
          params.render()
        })
      }
    }
  }
  
  /**
   * 鼠标释放事件
   */
  const handleMouseUp = (e: MouseEvent) => {
    const renderer = params.getRenderer()
    if (renderer) {
      renderer.domElement.style.cursor = 'default'
    }
    if (e.button === 0 || e.button === 2) {
      isPanning = false
      if (panRAF) {
        cancelAnimationFrame(panRAF)
        panRAF = 0
      }
      params.render()
    }
  }
  
  /**
   * 触摸结束事件
   */
  const handleTouchEnd = (e: TouchEvent) => {
    isPanning = false
    if (panRAF) {
      cancelAnimationFrame(panRAF)
      panRAF = 0
    }
    params.render()
  }
  
  /**
   * 触摸取消事件
   */
  const handleTouchCancel = (e: TouchEvent) => {
    isPanning = false
    if (panRAF) {
      cancelAnimationFrame(panRAF)
      panRAF = 0
    }
    params.render()
  }
  
  /**
   * 鼠标滚轮事件 - 处理缩放（以鼠标位置为中心）
   */
  const handleWheel = (e: WheelEvent) => {
    const renderer = params.getRenderer()
    const camera = params.getCamera()
    const container = params.getContainer()
    if (!renderer || !camera || !container) return
    
    e.preventDefault()
    
    const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05
    params.cameraZoom.value = Math.max(0.05, Math.min(100, params.cameraZoom.value * zoomFactor))
    
    const rect = container.getBoundingClientRect()
    
    // 获取鼠标在画布上的归一化坐标 (-1 到 1)
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1
    
    // 计算当前视野大小
    const currentWidth = camera.right - camera.left
    const currentHeight = camera.top - camera.bottom
    
    // 计算鼠标指向的世界坐标（缩放前）
    const worldX = camera.position.x + mouseX * (currentWidth / 2)
    const worldY = camera.position.y + mouseY * (currentHeight / 2)
    
    // 更新相机视野
    params.updateCameraView()
    
    // 计算新的视野大小
    const newWidth = camera.right - camera.left
    const newHeight = camera.top - camera.bottom
    
    // 计算缩放后鼠标指向的世界坐标
    const newWorldX = camera.position.x + mouseX * (newWidth / 2)
    const newWorldY = camera.position.y + mouseY * (newHeight / 2)
    
    // 调整相机位置，使鼠标指向的点保持在同一位置
    camera.position.x += worldX - newWorldX
    camera.position.y += worldY - newWorldY
    params.cameraPosition.value.set(camera.position.x, camera.position.y, camera.position.z)
    
    params.render()
  }
  
  /**
   * 禁用右键菜单
   */
  const handleContextMenu = (e: Event) => {
    e.preventDefault()
  }

  /**
   * 屏幕坐标转世界坐标
   */
  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } | null {
    const renderer = params.getRenderer()
    const camera = params.getCamera()
    if (!renderer || !camera) return null

    const rect = renderer.domElement.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null

    // 归一化到 [0, 1]
    const normalizedX = (clientX - rect.left) / rect.width
    const normalizedY = (clientY - rect.top) / rect.height

    // 使用相机参数直接计算世界坐标（加上相机位置偏移）
    const worldX = camera.position.x + camera.left + normalizedX * (camera.right - camera.left)
    const worldY = camera.position.y + camera.top - normalizedY * (camera.top - camera.bottom)

    return { x: worldX, y: worldY }
  }
  
  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleGlobalMouseMove,
    handleWheel,
    handleContextMenu,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    screenToWorld,
    isPanning: () => isPanning,
  }
}
