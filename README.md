# PCD 在线编辑器

一个独立的 PCD 单页面在线编辑器项目，包含轻量后端和前端页面。

## 功能

- 上传 `.pcd` 文件
- 上传后立即在前端解析并加载显示
- 支持 `ascii`、`binary`、`binary_compressed` PCD 数据格式
- 查看 PCD 点云
- 添加点
- 橡皮擦删除点
- 框选删除点
- 清空点
- 保存修改到后端
- 下载当前 PCD
- 删除 PCD 文件
- 文件列表刷新

## 项目结构

```text
pcd在线编辑器/
  backend/                  # .NET 后端接口
    Program.cs
    PcdOnlineEditor.Api.csproj
    PcdFiles/               # 运行后保存 PCD 文件，已被 .gitignore 忽略
  frontend/                 # Vue + Vite 单页面前端
    src/
      App.vue
      main.ts
      pcd.ts
      style.css
  start-backend.bat         # 启动后端
  start-frontend.bat        # 启动前端
```

## 环境要求

- Node.js
- npm
- .NET 8 SDK

## 启动后端

双击运行：

```text
start-backend.bat
```

或者命令行运行：

```bash
cd backend
dotnet run
```

后端地址：

```text
http://localhost:5088
```

## 启动前端

双击运行：

```text
start-frontend.bat
```

或者命令行运行：

```bash
cd frontend
npm install
npm run dev
```

前端地址：

```text
http://localhost:5177
```

## 构建前端

```bash
cd frontend
npm run build
```

说明：当前项目构建脚本使用 `vite build`。没有使用 `vue-tsc`，因为部分新版 Node.js 环境下旧版 `vue-tsc` 会出现兼容问题。

## 后端接口

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| GET | `/api/pcd` | 获取 PCD 文件列表 |
| GET | `/api/pcd/{name}` | 获取指定 PCD 内容 |
| POST | `/api/pcd/upload` | 上传 PCD 文件 |
| PUT | `/api/pcd/{name}` | 保存修改后的 PCD 内容 |
| DELETE | `/api/pcd/{name}` | 删除指定 PCD 文件 |

## 使用说明

1. 先启动后端。
2. 再启动前端。
3. 打开 `http://localhost:5177`。
4. 点击“上传 PCD”选择 `.pcd` 文件，上传后会立即解析并显示点云。
5. 如果上传后提示“没有解析到点数据”，请检查 PCD 文件头里的 `FIELDS x y z`、`POINTS`、`DATA` 是否正确。
6. 使用工具栏进行编辑：
   - 移动：拖动画布
   - 添加点：点击或拖动添加点
   - 橡皮擦：按刷子半径删除点
   - 框删：拖框删除范围内点
7. 点击“保存修改”保存到后端。
8. 点击“下载”可下载当前编辑后的 PCD。
9. 点击“删除”可删除后端保存的 PCD 文件。

## GitHub 提交建议

建议提交整个 `pcd在线编辑器` 文件夹。

已忽略内容：

- `frontend/node_modules/`
- `frontend/dist/`
- `backend/bin/`
- `backend/obj/`
- `backend/PcdFiles/`

其中 `backend/PcdFiles/` 是运行时上传文件目录，不建议提交到 GitHub。
