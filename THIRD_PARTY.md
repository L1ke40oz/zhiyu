# 上游来源与适配记录

## Phone Party

用户明确提供并要求复用的项目：[L1ke40oz/phone-party](https://github.com/L1ke40oz/phone-party)。

来源提交：`5002ac1963935a9127920ac4a9738388a4487b80`。

适配文件位于 `server/party/` 和 `public/party/`，保留上游文件内的说明。主要调整：统一 `/party/` 路径、接入应用 HTTP 服务、海岛主题样式、内置友善主持词、可信扫码地址、连接限制与玩家私有重连凭据。上游依赖 qrcode、ws 使用其各自的许可证。

本次读取的上游仓库未发现独立 LICENSE 文件。这里记录复用来源与用户授权背景，不为上游补造许可证；后续对外再分发的许可范围需以用户和权利人的实际授权为准。

## 共读交互参考

[L1ke40oz/astrbot_plugin_uluru_star](https://github.com/L1ke40oz/astrbot_plugin_uluru_star) 用于理解用户已有的共读模式。本应用独立实现课件与问答切换、阅读位置和卡点，不复制其插件代码或 AstrBot 运行时。

## 界面与运行依赖

animal-island-ui、naive-icons、Three.js、Tesseract.js、PDF.js、@napi-rs/canvas 及其他 npm 依赖的来源与版本记录在 package-lock.json，各自许可证保留于安装包中。用户提供及生成的参考图片只用于设计对照，没有作为可交互页面的整屏背景。
