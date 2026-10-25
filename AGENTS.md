# 知屿开发上下文

实现前阅读 [SPEC.md](./SPEC.md)、[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) 和 [DEPLOYMENT.md](./DEPLOYMENT.md)。

- 已确定部署到用户的自有 VPS，使用 1Panel 安装和管理的 OpenResty，已有域名。按该环境设计生产构建、服务、反向代理与数据持久化；基础设施是否具备无需重新询问。
- 首版是手机优先：整屏固定海面、固定岛屿槽位、常驻登记处；底栏为复习计划、课件共读、我的岛屿、派对码头、个人中心。
- 顶部 banner、顶部导航、首页齿轮和右侧今日修复面板已取消。归档原型尚有旧入口，实现以 Spec 最新决定为准。
- 模型结构化输出经过 Schema 和业务归属校验后再使用；学习与岛屿状态由程序根据真实事件计算。
- 用户指定小游戏仓库为 https://github.com/L1ke40oz/phone-party ，已适配进 `server/party/` 和 `public/party/`，无登录、扫码加入；共读参考为 https://github.com/L1ke40oz/astrbot_plugin_uluru_star ，不依赖 AstrBot 运行时。
- 本地 OCR 使用 Tesseract.js 6 与随依赖安装的中英语言包，无需用户另购 OCR 服务。AI、向量和视觉服务通过服务端 `.env` 配置，用户准备后续填写，不能假装已经实连。
- 实际开发与验证状态见 `docs/STATUS.md`。2026-10-25 用户确认域名为 `school.luminestella.top`，由用户在 1Panel 手动部署；服务器连接与资源参数尚未给出，按实际材料补充。具体步骤见 `deploy/1PANEL-QUICKSTART.md`。
- 2026-10-25 确认：桌面演示海面铺满窗口，沿用 lowpoly，加入水波、轻浮动和灯塔登记处；课程随机出现聚落岛与纯植被岛，按课程种子保持布局，先检查岸线和元素间距。
- 共读采用可拖动的悬浮气泡，文字划线持久化，提问附带经过原文校验的引用；关闭小测回到打开它的页面。个人中心可使用自己的 OpenAI 兼容 API；站点默认准备接用户已有 NewAPI。凭据不可写入文档或客户端。
- 最新海域规则：每片海域预留六个固定课程位置，集中成群岛；新增只填空位，不压缩、挤动已有课程岛，第七门进入下一片海域。灯塔登记处独立在左上角且不占六个名额。渲染与点击坐标统一使用 `shared/ocean-layout.ts`，旧三岛布局升级保留课程与学习数据。
- 线上已确认 OpenResty 使用 host 网络，代理到 `127.0.0.1:3100`，更新用基础 Compose，无需 bridge 网络覆盖文件。共读支持独立资料检索、视觉模型习题图片问答与 Tavily 回退搜索；个人中心可保存自己的 Tavily Key，站点默认用 `TAVILY_API_KEY`。工具进度是真实执行状态，图片和工具记录随对话保存。
