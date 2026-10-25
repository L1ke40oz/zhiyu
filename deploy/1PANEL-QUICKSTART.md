# school.luminestella.top · 1Panel 手动部署

日期：2026-10-25。域名已由用户确认；VPS 地址、硬件和 OpenResty 网络仍需在服务器上核对。

仓库地址：<https://github.com/L1ke40oz/zhiyu>。在 VPS 构建 Linux 镜像；Docker 会安装依赖并构建前端。开发机的 `.env`、课程数据、`node_modules` 和 `dist` 不提交到仓库。

React 前端和 Node.js 后端在代码中分开，部署时由同一个容器提供。OpenResty 负责域名、HTTPS 和整站代理，Node.js 提供页面、API、OCR、AI、SQLite 和小游戏 WebSocket。只部署前端静态文件无法运行完整应用，也不需要另建一个后端域名。

```text
浏览器 → https://school.luminestella.top
       → OpenResty → 知屿 Node.js 容器 :3100
                    ├─ 前端页面与资源
                    ├─ API、OCR、AI 与派对 WebSocket
                    └─ SQLite 和文件持久化卷
```

## 1. 在 1Panel 终端拉取代码

下面所有 shell 命令都在 **1Panel 的服务器终端** 执行。`/opt/zhiyu` 是可自行调整的应用目录，不是面板安装目录。首次部署：

```sh
cd /opt
git clone https://github.com/L1ke40oz/zhiyu.git zhiyu
cd /opt/zhiyu
```

如果 `/opt/zhiyu` 已存在且放着此前上传的源码，请保留已有配置和数据，先检查目录，避免重复克隆覆盖。也可继续使用上传包：在 1Panel 文件管理中解压到应用目录，确认 `Dockerfile` 和 `compose.yaml` 直接位于目录中。

核对运行环境：

```sh
cd /opt/zhiyu
docker version
docker compose version
uname -m
free -h
df -h .
```

Docker 必须正常运行并支持 Compose。VPS 需要能拉取 Node 基础镜像、Debian 软件包和 npm 依赖。本地 OCR 会占用额外内存，首次在服务器上解析扫描件时观察内存和日志。

## 2. 创建生产配置

```sh
test -f .env || cp deploy/.env.production.example .env
chmod 600 .env
```

使用文件管理编辑 `.env`，已预填：

```dotenv
PUBLIC_ORIGIN=https://school.luminestella.top
BIND_ADDRESS=127.0.0.1
APP_PORT=3100
```

需要站点默认 AI 时填写 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`；NewAPI 地址包含实际的 `/v1` 前缀。留空也能启动，问答退回有来源的原文摘录，不会提供模型讲解。Embedding 和 Vision 是独立可选配置；本地中英 OCR 默认开启。

`PUBLIC_ORIGIN` 保留 HTTPS 和实际域名，不加路径。个人设置中的相对 AI 代理地址依赖此项。配置修改后需要重新创建容器才能加载新的环境变量。

## 3. 检查 OpenResty 网络，选择启动命令

先查到实际 OpenResty 容器名称：

```sh
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

把下面的 `实际OpenResty容器名` 替换成上一步看到的名称：

```sh
docker inspect 实际OpenResty容器名 --format '{{.HostConfig.NetworkMode}}'
docker inspect 实际OpenResty容器名 --format '{{json .NetworkSettings.Networks}}'
```

### A. 网络模式是 host，或 OpenResty 直接运行在宿主机

```sh
docker compose -p zhiyu up -d --build
docker compose -p zhiyu ps
docker compose -p zhiyu logs --tail=100 zhiyu
curl -fsS http://127.0.0.1:3100/api/health
```

站点反向代理目标填写 `http://127.0.0.1:3100`。

### B. OpenResty 在 bridge 网络

从 inspect 输出找到它已加入的用户定义 bridge 网络名，在 `.env` 加入一行（替换为实际值）：

```dotenv
OPENRESTY_NETWORK=实际OpenResty网络名
```

随后使用两份 Compose 文件启动，让应用加入同一网络：

```sh
docker compose -p zhiyu -f compose.yaml -f deploy/compose.openresty-network.yaml up -d --build
docker compose -p zhiyu -f compose.yaml -f deploy/compose.openresty-network.yaml ps
docker compose -p zhiyu -f compose.yaml -f deploy/compose.openresty-network.yaml logs --tail=100 zhiyu
curl -fsS http://127.0.0.1:3100/api/health
```

站点反向代理目标填写 `http://zhiyu-app:3100`。应用仍只把宿主机端口发布到回环地址，不用为 3100 开放公网端口。

容器之间按服务名／网络别名和容器端口访问，见 [Docker 官方网络说明](https://docs.docker.com/compose/how-tos/networking/)。不要把临时容器 IP 填成长期代理目标。如果 OpenResty 只加入 Docker 内置 `bridge`、使用其他网络模式，或加入网络后仍无法解析别名，先核对网络，再配置站点。

**B 模式后续所有 Compose 操作都保留两份 `-f` 参数。** 本文统一使用项目名 `-p zhiyu`，数据卷默认是 `zhiyu_zhiyu-data`。不要更换项目名或目录后启动另一套空卷，也不要同时在面板里创建另一套同名应用。

## 4. 域名与反向代理

1. 在 DNS 服务商处，把 `school.luminestella.top` 的 A 记录指向实际 VPS IPv4；仅在 VPS 的 IPv6 链路可用时添加 AAAA。
2. 在 1Panel 的「网站 → 创建网站 → 反向代理」创建该域名站点，目标按上面的 A／B 模式选择。这对应 [1Panel 官方创建网站说明](https://docs.fit2cloud.com/1panel/user_manual/websites/website-create/)中的反向代理类型；不同版本菜单可能不同。
3. 申请并绑定该域名证书，再启用 HTTP 跳转 HTTPS。证书验证所需的入站访问按实际验证方式配置。
4. 编辑该站点配置，参考同目录的 `openresty-location.conf.example`；先合并已有 `location /`，避免重复。B 模式把示例中两处 `http://127.0.0.1:3100` 都改成 `http://zhiyu-app:3100`。
5. 确认上传限制 `client_max_body_size 24m`、普通请求超时 390 秒、`/party/ws` 的 HTTP/1.1 与 Upgrade／Connection 头已生效。升级头必须显式传递，见 [NGINX 官方 WebSocket 说明](https://nginx.org/en/docs/http/websocket.html)。当前问答返回完整响应，无需 SSE 配置。
6. 在面板中检查并重载 OpenResty 配置。代理目标必须能够从 OpenResty 所在环境访问。

`TRUST_PROXY` 暂时留空也能依靠 `PUBLIC_ORIGIN` 设置安全 Cookie 并校验请求来源。若要正确按客户端 IP 限流，核对 Node 实际接收到的受控代理来源，再填其 IP／CIDR；不要未经核对设置为信任所有代理。

## 5. 验收

```sh
curl -fsS https://school.luminestella.top/api/health
```

应返回 `ok: true` 的 JSON，不能返回前端 HTML。再用手机打开域名，检查：

- 创建课程岛、刷新保留；上传文本和扫描件、查看解析结果及引用页码。
- 配置了 AI 才验证真实模型问答与出题；未配置时应显示原文模式。
- 记录卡点、完成小测、查看学习记录；派对主持端 `/party/host` 建房，手机扫码加入，确认 WebSocket 正常。
- A 模式执行 `docker compose -p zhiyu restart zhiyu`；B 模式加上两份 `-f`。重启后课程、上传文件和学习记录仍在；派对房间属于临时状态，会清空。

当前没有账号登录。匿名学习空间绑定浏览器 Cookie；更换浏览器、清除 Cookie，或从本地域名切到线上域名，会进入新的空间。上传包没有迁移本地课程数据。

## 6. 更新、备份与排错

更新前保留上一版源码包和镜像版本，并备份数据。数据库、上传文件和个人 API 加密文件共同保存在 `/app/data` 的命名卷中。**不要执行 `docker compose down -v` 或删除数据卷。**

一致性备份可以先停应用，再用只读卷导出完整目录；先确认 `docker volume inspect zhiyu_zhiyu-data` 指向本项目实际数据卷，且服务器已有 `node:24-bookworm-slim` 镜像。下面命令以 A 模式为例，遇到备份错误会尝试恢复服务：

```sh
docker volume inspect zhiyu_zhiyu-data
mkdir -p backups
backup_name="zhiyu-data-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose -p zhiyu stop zhiyu
if docker run --rm --user 0 -v zhiyu_zhiyu-data:/data:ro -v "$PWD/backups:/backup" node:24-bookworm-slim tar -czf "/backup/$backup_name" -C /data .; then
  docker compose -p zhiyu start zhiyu
else
  docker compose -p zhiyu start zhiyu
  echo '备份失败，请查看前面的错误输出。' >&2
fi
```

B 模式在 stop／start 命令中同样补齐两份 `-f` 参数。备份中含个人资料和加密文件，妥善保存，不放到网站可下载目录。不要在应用运行中仅复制 SQLite 主文件来充当完整备份。

从 GitHub 克隆的部署，备份后在同一项目目录更新：

```sh
cd /opt/zhiyu
git pull --ff-only origin main
```

保留 `.env` 和数据卷，然后运行与首次相同的 `up -d --build`。B 模式容器重建后在面板重载 OpenResty，让代理重新解析容器地址。Compose 重建服务会保留挂载卷，见 [Docker 官方启动说明](https://docs.docker.com/reference/cli/docker/compose/up/)。如果新版修改数据结构，回退应用时同时评估是否恢复更新前的数据备份。使用上传包的部署仍可更新源码包，保留原配置和卷。

常见故障：

| 现象 | 检查 |
| --- | --- |
| 镜像构建失败 | 基础镜像拉取、Debian/npm 网络、磁盘和内存；保留第一条错误 |
| 502 | 应用日志、健康状态、OpenResty 网络和代理目标；bridge 中的 127.0.0.1 指向 OpenResty 自己 |
| 413 | 站点有效配置的上传限制是否为 24m；应用单文件仍限 20MB |
| 写入接口 403 | 浏览器使用的域名、HTTPS 和 PUBLIC_ORIGIN 是否一致 |
| 页面正常但派对断线 | `/party/ws` 升级头、代理目标、WebSocket 状态码 |
| OCR 被杀或容器重启 | 容器日志、VPS 内存和 OOM 记录 |
| 更新后课程消失 | 是否换了项目名、数据卷或浏览器 Cookie；先定位原卷，不删除任何卷 |

## 本地复核记录

2026-10-25：`npm run build`（含 TypeScript 检查）通过；`npm test` 全部 44 项通过；独立数据目录的生产服务启动后，首页、前端脚本、健康检查、派对主持页和匿名空空间检查通过。当前本机没有 Docker，Linux 镜像和真实域名链路需在 VPS 上验证，尚未上线。
