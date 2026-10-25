# 知屿

把每门课变成一座小海岛。上传资料、记录卡点、共读和复习，让岛上的聚落一点点生长。

手机优先，五项底栏：复习计划、课件共读、我的岛屿、派对码头、个人中心。首次进入只显示海面与登记处，演示资料不会自动写入新用户空间。

## 本地启动

需要 Node.js 24 或更新的兼容版本。

```powershell
npm.cmd ci
npm.cmd run dev
```

打开 [本地开发页面](http://localhost:5177)。网页端口为 5177，API 为 3100；前端通过代理访问同源 API。实际监听端口见启动输出。

生产构建预览：

```powershell
npm.cmd run build
npm.cmd start
```

打开 [本地生产页面](http://localhost:3100)。停止开发服务器后再启动生产服务，避免 3100 端口冲突。

在局域网手机上试用时，使用电脑实际局域网地址与网页端口。派对的摄像头、麦克风和动作传感器需要 HTTPS，正式手机体验通过部署域名进行；电脑调试保留鼠标和键盘备用输入。

## AI 与 OCR 配置

把 `.env.example` 复制为 `.env`。本地 OCR 已包含简体中文和英文语言包，不需要申请服务商或填写 OCR 密钥；安装依赖后，识别过程在应用服务器本地运行。

AI 服务可后续填写，填写后重启后端：

| 能力 | 环境变量 | 配置状态与行为 |
| --- | --- | --- |
| AI 讲解、知识点整理与出题 | `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY` | 服务需支持兼容的 `/chat/completions` 及 JSON 对象响应；Base URL 包含实际 `/v1` 等前缀 |
| 向量检索 | `EMBEDDING_BASE_URL`、`EMBEDDING_MODEL`、`EMBEDDING_API_KEY` | 服务需支持 `/embeddings`；地址和模型独立配置 |
| 本地 OCR | `OCR_ENABLED=true`、`OCR_LANGUAGES=chi_sim+eng` | 默认开启，本地语言包，无运行时语言下载 |
| 复杂页面视觉转写 | `VISION_BASE_URL`、`VISION_MODEL`、`VISION_API_KEY` | 可选，需支持含 `image_url` 的聊天消息；识别存疑时尝试 |

没有配置 AI 时：仍然可以建岛、上传、阅读、OCR、搜索原文、记录卡点、做原文填空式单选练习和查看学习记录。回答明确显示资料摘录，小测明确标注原文回忆。

配置 AI 后：新上传资料可生成有来源的知识点候选；问答和出题使用模型，输出先过 Schema 与引用归属校验，最多追加两次修复。格式与业务验证不保证模型内容一定正确，回答仍保留来源与核实提示。

站点默认支持用户已有的 **NewAPI**：把其兼容接口地址填到 `LLM_BASE_URL`，模型 ID 和 Key 填到对应环境变量。可通过现有 OpenResty 代理，后端也可使用服务器内部可达的实际 NewAPI 地址；具体地址和网络按部署时核对。

个人中心 → 我的 AI 伙伴支持独立个人配置，填写 HTTPS Base URL（到 `/v1`）、模型 ID 和 Key，保存后用于当前匿名空间的问答、出题及新资料知识点整理。站点的 OCR、视觉转写与 embedding 配置继续共用。支持 HTTPS 站点上的相对代理路径，例如 `/model-api/v1`。测试连接只查询模型列表，不发付费补全请求；部分服务不提供列表时需要实际问答验证。

个人 Key 在后端使用 AES-256-GCM 加密，API 不回显、前端不写 localStorage。更换服务地址必须重填 Key。备份和迁移时连同 `DATA_DIR/api-encryption.key` 与数据库一起备份；丢失加密文件后需重新填写个人 Key。

上传后才配置向量服务时，可在共读中重新建立该资料的向量索引。索引未建立或服务失败时，关键词检索仍可用。课件共读的「检索资料」可直接检索整门课程或当前课件，查看原文片段并跳转页码。

「问 AI」支持上传、拖入或粘贴一张 PNG／JPG／WebP 习题图片，最多 10MB；服务端使用已有 `VISION_BASE_URL`、`VISION_API_KEY`、`VISION_MODEL` 识别和解答，并结合课件检索。图片随对话保存在持久化卷中，仅当前学习空间可访问；不会作为课程资料自动入库。

课件无匹配片段时，可自动调用 Tavily 联网补充。在服务端 `.env` 填写 `TAVILY_API_KEY` 作为站点默认配置；用户也可在个人中心「联网搜索」填写自己的 Tavily Key。个人 Key 加密保存，接口不会回显。调用使用 [Tavily 官方搜索接口](https://docs.tavily.com/documentation/api-reference/endpoint/search)，无需额外注册工具。聊天展示实际检索阶段、搜到的网页和来源链接，工具记录随消息保存。当前问答仍以完整响应返回，通过短轮询展示工具进度，未实现 SSE。

图标点击使用轻量的合成玩具音效，可在个人中心独立关闭，海浪声默认关闭。课程资料与知识图谱使用相同高度的弹窗，内容在内部滚动，底部共读按钮独立留位。

## 资料与数据

- 支持文本 PDF、扫描 PDF、PPTX、PNG、JPG、WebP、UTF-8 TXT／Markdown。
- 单份课件不超过 20MB，PDF／PPTX 不超过 50 页；旧版 `.ppt` 请另存为 `.pptx` 或导出 PDF。问答习题图片单独限制为 10MB。
- 混合页面会检查图片内容，原生文字少的页面使用本地 OCR；低可信结果保留警告和原图。
- SQLite、原始文件、页面图与 OCR 缓存保存在 `DATA_DIR`，默认 `./data`。
- 无登录模块，每个浏览器通过 HttpOnly Cookie 拥有自己的匿名学习空间。清除 Cookie 或更换浏览器会进入新的空间；首版没有账号恢复与跨设备同步。
- 知识点名字和卡点可修改；真实作答由程序评分并推动对应知识区域变化，待复习雾气不摧毁已有建筑。
- 读过提示与独立作答分开记录；重复提交不重复成长，派对游戏成绩不参与课程评分。
- 岛屿随机出现少量小屋的聚落和纯植被两种布局；树木、花丛、石头等按课程 ID 稳定生成，并检查岸线与元素间距。登记处为常驻灯塔岛。海面铺满桌面窗口，水波和浮动可在个人中心减少动态效果。
- 每片海域固定预留六个课程位置，集中成错落群岛；灯塔登记处独立在左上角。岛屿数量增加不会缩小或挤动已有岛，第七门课程自动进入下一片海域，可用海面底部入口切换。旧三岛海域会自动升级，课件与学习记录保留。
- 共读始终保留课件，AI 通过可拖动气泡展开。文字视图中选句后可只划线或划线并提问，标记刷新后保留；图片／PDF 请切换到识别文字后划线。引用位置与原文由后端核验。
- 新资料按章节、完整句子整理知识点，复习任务显示课件与页码；旧资料仅修复仍使用默认截断标题的名称，不清除已有作答或用户改名。

## 派对码头

已把用户提供的 [phone-party](https://github.com/L1ke40oz/phone-party) 房间、五类小游戏、二维码和 WebSocket 集成到同一个应用服务：

- 主持端：`/party/host`。
- 玩家端：`/party/?room=房间号`。
- WebSocket：`/party/ws`。
- 不需注册，昵称加入，最多 8 人；房间与成绩在服务内存中，服务重启后清空。
- 采用暖色海岛主题和内置主持词；原项目的模型主持 SDK 未引入本应用。
- 设备识别和结果判定沿用原项目的手机端实现，适合现场娱乐互动。

共读交互参考 [astrbot_plugin_uluru_star](https://github.com/L1ke40oz/astrbot_plugin_uluru_star)，未把 AstrBot 运行时或插件代码加入应用。

## VPS／1Panel／OpenResty

这是前后端一体交付的应用：React 前端构建后由同一个 Node.js 服务提供，课程、上传、OCR、AI、SQLite 和派对 WebSocket 也由该服务处理。部署时只启动一个应用容器，再让 OpenResty 整站反向代理到它，不需要分别部署两个网站。只上传 `dist` 到静态站点无法提供后端功能。

本次域名为 `school.luminestella.top`。从 GitHub 拉取并通过 1Panel 手动部署的完整步骤见 [deploy/1PANEL-QUICKSTART.md](./deploy/1PANEL-QUICKSTART.md)。

已提供 Dockerfile、Compose 和 `deploy/openresty-location.conf.example`。部署入口沿用用户已有 VPS、1Panel、OpenResty 与自有域名，详细步骤见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

```sh
cp .env.example .env
# 在 .env 中配置 PUBLIC_ORIGIN=https://实际项目域名 与可选模型服务
docker compose up -d --build
```

默认宿主机发布到 `127.0.0.1:3100`，使用命名卷保存数据。OpenResty 如果处于独立容器网络，先根据实际拓扑调整上游地址和网络连接。不要直接套用回环地址。

## 验证与项目文档

```powershell
npm.cmd test
npm.cmd run build
```

测试覆盖会话隔离、来源校验、有限 JSON 修复、复习规则、重复提交、持久化查询、本地图片 OCR、原生／扫描／混合 PDF，以及真实 WebSocket 房间交互。

规格见 [SPEC.md](./SPEC.md)，开发阶段见 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)，实际交付与待完成事项见 [docs/STATUS.md](./docs/STATUS.md)，上游来源见 [THIRD_PARTY.md](./THIRD_PARTY.md)。
