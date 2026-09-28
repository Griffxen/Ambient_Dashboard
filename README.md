# Ambient Dashboard

面向 14 英寸竖屏副屏的常驻信息画面。界面尽量只保留功能文字，装饰使用几何图案。

## 开发与打包

Ubuntu 和 Windows 使用同一代码库。先安装 Node.js 22 或 24，再在项目目录运行：

```sh
npm ci
npm run dev
```

另开终端运行桌面窗口。开发时 `DASHBOARD_DEV=1` 允许在没有目标竖屏时预览：

```sh
DASHBOARD_DEV=1 npm run desktop
```

Windows PowerShell 对应命令为 `$env:DASHBOARD_DEV='1'; npm run desktop`。

主屏控制页：开发预览使用 `http://127.0.0.1:5173/control`；正式桌面程序运行时使用 `http://127.0.0.1:3988/control`。正式控制服务仅监听本机地址。控制页可切换模式、切换图案、刷新日程、将时间轴回到顶部、逐条编辑 Memo，查看状态和性能指标，并修改详细设置。修改后点击对应的保存按钮；副屏会在原页面同步更新。右上角“关闭软件”经过页面内确认后，会退出桌面程序及其本机服务。

正式打包分别运行 `npm run package:linux`（Ubuntu AppImage）或在 Windows 上运行 `npm run package:windows`（NSIS 安装程序）。输出位于 `release/`。正式启动时只在非主屏的竖屏上显示；副屏缺失时程序与控制服务继续运行，控制面板显示“未连接”，检测到副屏后自动打开展示。高级设置 `targetDisplayId` 可指定屏幕 ID，需填入当前 Electron `screen` API 报告的数字 ID。控制面板可单独关闭或重新打开副屏展示；开发预览会使用普通窗口。

从开始菜单手动启动时会同时打开控制面板；登录自动启动时只启动副屏展示和本机控制服务。程序使用单实例锁，重复点击开始菜单会唤起已有实例并打开或聚焦现有控制面板，不会重复启动多个后台程序。Ubuntu 开始菜单图标安装在当前用户的 `~/.local/share/icons/hicolor/512x512/apps/ambient-dashboard.png`，桌面入口位于 `~/.local/share/applications/ambient-dashboard.desktop`，该图标主题路径可供 Wayland 桌面菜单读取。

## 通用展示接口

本机程序可向 `POST http://127.0.0.1:3988/api/dashboard/system/presence` 发送一个临时展示实例。它会在上半区与音乐、天气提醒使用同一套淡入淡出布局；提供 `detail` 时，鼠标悬停或键盘聚焦可查看详情。新实例会替换当前实例，默认展示 12 秒。

```sh
curl -X POST http://127.0.0.1:3988/api/dashboard/system/presence \
  -H 'Content-Type: application/json' \
  -d '{"title":"下载完成","summary":"研究资料已保存","detail":"共 12 个文件，1.8 GB\n保存位置：资料库 / 本周","icon":"✓","durationMs":12000}'
```

`title` 与 `summary` 必填；`detail`、`icon`、`id`、`durationMs` 可选。展示时长限制为 3–60 秒。发送 `DELETE` 到同一路径可立即收起当前实例。接口只监听 `127.0.0.1`，不对局域网开放。

## 规划器

规划器地址需要在设置中由用户配置；示例使用 `https://planner.example.invalid`，不会内置任何特定服务地址。Token 只从当前用户的 `~/.config/ambient-dashboard/planner_token.txt` 读取，建议文件权限为 `600`；前端不读取 Token。Windows 对应路径为用户主目录下的 `.config/ambient-dashboard/planner_token.txt`。日程更新失败时保留最近一次成功数据，并以弱提示标记可能未更新。

配置文件位于 `~/.config/ambient-dashboard/config.json`，示例：

```json
{
  "plannerUrl": "https://planner.example.invalid",
  "plannerTokenFile": "/absolute/path/to/planner_token.txt",
  "agendaRefreshSeconds": 60,
  "highLoadCpu": 85,
  "highLoadGpu": 60,
  "highLoadSeconds": 30,
  "alwaysPerformance": false,
  "targetDisplayId": null
}
```

界面设置层可调整明暗、生成艺术、动画、日程密度与自动滚动速度（0 为关闭）、天气位置、性能模式自动切换与登录自启。自动模式在 CPU 或 GPU 持续高负载后进入 Performance，在两者均连续 90 秒低于阈值后返回 Normal；控制面板可启用“常驻 Performance”来禁止自动返回。`Alt+P` 切换 Normal / Performance；`Ctrl+,` 打开设置；`Ctrl+Shift+Q` 退出。登录自启在正式打包应用中生效。

## 信息与交互

课程显示开始时间。事项只展示未完成项；时间列取尚未经过的开始、结束、截止中的最早者。截止已过时固定标记截止与逾期。纯日期的开始按 00:00，结束和截止按 23:59。时间列的“始 / 止 / 限”对应开始、结束、截止，常态仅显示日号；课程名称后用 `@` 标教室。事项的名称与类型标签同行，备注悬停时原位显示。SCHEDULE 标题旁显示最近成功获取时间，刷新失败时标“未更新”。

Memo 本地保存为结构化 JSON，支持长期、限时与指定过期时间。点击 `EDIT` 可本机编辑；扫码可在同一局域网用手机访问固定地址 `http://<本机局域网地址>:3987/memo`。手机页支持输入、保存、清空与有效期。Memo 不会上传到云端。

天气由 Open-Meteo 获取，只在未来降雨或明显降温时短暂出现。音乐由 Ubuntu MPRIS 或 Windows 系统媒体会话读取。Performance 每 5 秒采样，显示 CPU、GPU、RAM、温度、功耗、VRAM、频率、风扇、网络和磁盘读写；曲线保留最近 15 分钟。硬件不提供的指标显示 `—`。

自动刷新只更新对应区域的数据，不重载页面。`prefers-reduced-motion` 与设置中的低动画/关闭动画会降低动效。

## 当前验证范围

已在 Ubuntu 完成 TypeScript/Vite 构建、Linux AppImage 打包和 700×1120 CSS px 浏览器预览。AppImage 约 113 MB；开发预览中，Electron 主进程及直接子进程的一次 RSS 采样合计约 418 MiB。该采样包含共享页的重复计数，不等于实际独占内存；目标副屏上的长期占用仍需实测。Windows 安装程序、Windows 媒体/硬件采集、实际副屏选择与登录自启需在 Windows 和目标副屏上实测。

## 许可证

本项目采用 GNU AGPL v3 或更高版本（AGPL-3.0-or-later），详见 [LICENSE](LICENSE)。

Copyright (c) 2026 Ruixiao Guo (Griffxen), College of Engineering, Peking University, Undergraduate.

允许使用、修改与商业使用，但须遵守 AGPL 的源码提供、版权声明保留等要求。修改版通过网络提供交互服务时，应按第 13 条向远程用户提供获取对应源码的方式。详见 [版权声明](LICENSE) 和 [许可证说明](LICENSE)。
