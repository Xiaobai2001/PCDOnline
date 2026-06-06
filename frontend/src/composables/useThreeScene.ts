import { type Ref } from 'vue'
import * as THREE from 'three'

/**
 * Three.js 场景管理组合式函数
 * 负责场景、相机、渲染器、网格、坐标轴的初始化和管理
 * 基于原始 map-editor 项目的成熟实现
 */
export const useThreeScene = (params: {
  container: Ref<HTMLElement | undefined>
  cameraZoom: Ref<number>
  cameraPosition: Ref<THREE.Vector3>
  initialCameraZoom: number
  baseViewSize: Ref<number>
  sceneBackground?: number
  mouseHandlers: {
    handleWheel: (e: WheelEvent) => void
    handleMouseDown: (e: MouseEvent) => void
    handleContextMenu: (e: Event) => void
    handleTouchStart?: (e: TouchEvent) => void
    handleTouchMove?: (e: TouchEvent) => void
    handleTouchEnd?: (e: TouchEvent) => void
    handleTouchCancel?: (e: TouchEvent) => void
  }
}) => {
  // Three.js 核心对象
  let scene: THREE.Scene | null = null
  let camera: THREE.OrthographicCamera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  
  // 资源管理
  const resizeObservers: ResizeObserver[] = []
  
  /**
   * 渲染场景
   */
  const render = () => {
    if (!renderer || !scene || !camera) return
    renderer.render(scene, camera)
  }
  
  /**
   * 更新相机视野（基于基准视野和缩放级别）
   */
  const updateCameraView = () => {
    if (!camera || !params.container.value) return
    
    const rect = params.container.value.getBoundingClientRect()
    const aspect = rect.width / rect.height
    const viewSize = params.baseViewSize.value / params.cameraZoom.value
    
    camera.left = -viewSize * aspect / 2
    camera.right = viewSize * aspect / 2
    camera.top = viewSize / 2
    camera.bottom = -viewSize / 2
    camera.updateProjectionMatrix()
  }
  
  /**
   * 创建坐标轴辅助对象
   */
  const createAxes = (): THREE.Line[] => {
    const axesLength = 50
    const axesZPosition = 10
    const zAxisLength = 10
    
    // X轴（红色）
    const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, axesZPosition),
      new THREE.Vector3(axesLength, 0, axesZPosition)
    ])
    const xAxis = new THREE.Line(xAxisGeometry, new THREE.LineBasicMaterial({ 
      color: 0xff0000, 
      linewidth: 2,
      depthTest: false
    }))
    xAxis.renderOrder = 999
    xAxis.position.set(0, 0, 1)  
    
    // Y轴（绿色）
    const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, axesZPosition),
      new THREE.Vector3(0, axesLength, axesZPosition)
    ])
    const yAxis = new THREE.Line(yAxisGeometry, new THREE.LineBasicMaterial({ 
      color: 0x00ff00, 
      linewidth: 2,
      depthTest: false
    }))
    yAxis.renderOrder = 999
    yAxis.position.set(0, 0, 1)  
    
    // Z轴（蓝色）
    const zAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, axesZPosition),
      new THREE.Vector3(0, 0, axesZPosition + zAxisLength)
    ])
    const zAxis = new THREE.Line(zAxisGeometry, new THREE.LineBasicMaterial({ 
      color: 0x0000ff, 
      linewidth: 2,
      depthTest: false
    }))
    zAxis.renderOrder = 999
    zAxis.position.set(0, 0, 1)  
    return [xAxis, yAxis, zAxis]
  }
  
  /**
   * 初始化Three.js场景
   */
  const initScene = () => {
    if (!params.container.value) return false
    
    const container = params.container.value
    const width = container.clientWidth
    const height = container.clientHeight
    
    // 创建场景
    scene = new THREE.Scene()
    scene.background = null
    
    // 创建正交相机（适合2D地图）
    const aspect = width / height
    const viewSize = 100
    camera = new THREE.OrthographicCamera(
      -viewSize * aspect / params.cameraZoom.value,
      viewSize * aspect / params.cameraZoom.value,
      viewSize / params.cameraZoom.value,
      -viewSize / params.cameraZoom.value,
      0.1,
      1000
    )
    camera.position.set(0, 0, 1000)
    camera.lookAt(0, 0, 0)
    camera.up.set(0, 1, 0)
    
    // 创建渲染器
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setClearColor(params.sceneBackground ?? 0xffffff, 0)
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.sortObjects = true
    container.appendChild(renderer.domElement)
    
    params.cameraZoom.value = params.initialCameraZoom
    updateCameraView()
    
    // 创建坐标轴
    const axes = createAxes()
    axes.forEach(axis => scene?.add(axis))
 
    // 窗口大小改变
    const handleResize = () => {
      if (!params.container.value || !camera || !renderer) return
      const width = params.container.value.clientWidth
      const height = params.container.value.clientHeight
      
      renderer.setSize(width, height)
      updateCameraView()
      render()
    }
    
    window.addEventListener('resize', handleResize)
    const resizeObserver = new ResizeObserver(() => handleResize())
    resizeObserver.observe(container)
    resizeObservers.push(resizeObserver)
    
    // 添加鼠标控制 - 直接绑定到 renderer.domElement（最可靠的方式）
    renderer.domElement.addEventListener('wheel', params.mouseHandlers.handleWheel, { passive: false })
    renderer.domElement.addEventListener('mousedown', params.mouseHandlers.handleMouseDown)
    renderer.domElement.addEventListener('contextmenu', params.mouseHandlers.handleContextMenu)
    
    // 添加触摸控制
    if (params.mouseHandlers.handleTouchStart) {
      renderer.domElement.addEventListener('touchstart', params.mouseHandlers.handleTouchStart, { passive: false })
    }
    if (params.mouseHandlers.handleTouchMove) {
      renderer.domElement.addEventListener('touchmove', params.mouseHandlers.handleTouchMove, { passive: false })
    }
    if (params.mouseHandlers.handleTouchEnd) {
      renderer.domElement.addEventListener('touchend', params.mouseHandlers.handleTouchEnd, { passive: false })
    }
    if (params.mouseHandlers.handleTouchCancel) {
      renderer.domElement.addEventListener('touchcancel', params.mouseHandlers.handleTouchCancel, { passive: false })
    }
    
    render()
    return true
  }
  
  /**
   * 清理场景资源
   */
  const dispose = () => {
    // 清理resize监听
    resizeObservers.forEach(observer => observer.disconnect())
    resizeObservers.length = 0
    
    // 清理渲染器和事件
    if (renderer) {
      renderer.domElement.removeEventListener('wheel', params.mouseHandlers.handleWheel)
      renderer.domElement.removeEventListener('mousedown', params.mouseHandlers.handleMouseDown)
      renderer.domElement.removeEventListener('contextmenu', params.mouseHandlers.handleContextMenu)
      if (params.mouseHandlers.handleTouchStart) {
        renderer.domElement.removeEventListener('touchstart', params.mouseHandlers.handleTouchStart)
      }
      if (params.mouseHandlers.handleTouchMove) {
        renderer.domElement.removeEventListener('touchmove', params.mouseHandlers.handleTouchMove)
      }
      if (params.mouseHandlers.handleTouchEnd) {
        renderer.domElement.removeEventListener('touchend', params.mouseHandlers.handleTouchEnd)
      }
      if (params.mouseHandlers.handleTouchCancel) {
        renderer.domElement.removeEventListener('touchcancel', params.mouseHandlers.handleTouchCancel)
      }
      if (renderer.parentElement) {
        renderer.parentElement.removeChild(renderer.domElement)
      }
      renderer.dispose()
      renderer = null
    }
    
    // 清理场景
    if (scene) {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose()
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach(m => m.dispose())
            } else {
              object.material.dispose()
            }
          }
        }
      })
      scene.clear()
      scene = null
    }
    
    camera = null
  }
  
  return {
    initScene,
    render,
    updateCameraView,
    dispose,
    getScene: () => scene,
    getCamera: () => camera,
    getRenderer: () => renderer,
  }
}
