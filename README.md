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

Windows 副屏展示全屏置顶于普通窗口和任务栏之上，不单独显示任务栏按钮，禁止普通最小化，并在收到最小化事件时恢复展示；打开展示时不主动抢占主屏焦点。通过控制页仍可关闭副屏展示或退出软件。Windows 锁屏的安全桌面不显示 Dashboard，其他置顶窗口或独占全屏程序也可能覆盖它。Linux 在 X11/XWayland 下使用桌面背景类型的无边框展示窗口，铺满目标副屏，打开时不主动激活，不启用置顶或原生全屏。主屏控制页仍正常接收输入。Wayland 会话请使用 `--ozone-platform=x11` 启动以启用这一窗口行为；原生 Wayland 不支持 Electron 的静默显示与窗口定位。

Windows 时钟使用离线自带的 IBM Plex Mono 等宽字体，固定数字宽度；Linux 保留原时钟字体。

Windows 提供托盘图标：单击打开控制面板，右键可开关副屏展示或退出。托盘不改变 Linux 的窗口行为。

和风天气与账号统计共用 `~/.config/ambient-dashboard/qweather.json`，Windows 对应 `C:\Users\<用户名>\.config\ambient-dashboard\qweather.json`。账号官方统计自动包含同账号两端的成功请求；本软件逐接口成功/失败统计可通过控制页的「跨系统天气统计文件」共享。建议 Windows 使用 `D:\SharedData\AmbientDashboard\weather-usage.json`，Linux 挂载该盘后填写同一文件的 Linux 绝对路径（例如 `/media/<用户名>/<卷标>/SharedData/AmbientDashboard/weather-usage.json`），再保存基础配置。也可在各自 `config.json` 设置 `weatherUsageFile`。密钥保持在各系统用户目录，不放到共享统计文件中。

两端启动后自动合并用户目录内已有的 `weather-usage.json`，按记录 ID 去重并保留滚动 24 小时的成功和失败请求；共享文件暂不可用时继续保存本机记录，恢复后自动合并。旧版无 ID 的记录也可迁移，重复导入不会重复计数。Linux 需重新编译 AppImage，挂载共享分区且保证可写；原有天气接口和调度间隔不变。这里累计的是滚动 24 小时统计，并非历史总计。

正式打包分别运行 `npm run package:linux`（Ubuntu AppImage）或在 Windows 上运行 `npm run package:windows`（NSIS 安装程序）。输出位于 `release/`。正式启动时只在非主屏的竖屏上显示；副屏缺失时程序与控制服务继续运行，控制面板显示“未连接”，检测到副屏后自动打开展示。高级设置 `targetDisplayId` 可指定屏幕 ID，需填入当前 Electron `screen` API 报告的数字 ID。控制面板可单独关闭或重新打开副屏展示；开发预览会使用普通窗口。

从开始菜单、任务栏或登录自启启动时，只启动副屏展示和本机控制服务。程序使用单实例锁，应用已运行时，再次点击启动会打开或聚焦控制面板，不会重复启动后台程序。需要控制面板时可访问 `http://127.0.0.1:3988/control`，或使用 `--control` 参数启动以打开独立控制窗口。Ubuntu 开始菜单图标安装在当前用户的 `~/.local/share/icons/hicolor/512x512/apps/ambient-dashboard.png`，桌面入口位于 `~/.local/share/applications/ambient-dashboard.desktop`，该图标主题路径可供 Wayland 桌面菜单读取。

## 通用展示接口

本机程序可向 `POST http://127.0.0.1:3988/api/dashboard/system/presence` 发送临时展示实例。常态只显示 `icon + summary`；提供 `detail` 时，鼠标悬停或键盘聚焦会在右下角展开 `title + detail`。每个调用方应使用稳定且唯一的 `id`：相同 `id` 更新原槽位并刷新有效期，不同 `id` 按首次到达顺序分配到 3 个槽位。超过 3 条后，新实例进入当前最空的槽位；每个槽独立每 10 秒轮播。只有某个槽内超过一条时，该槽才显示 `x/y`，数字表示本槽内的位置和数量，而不是全部实例数量。

```sh
curl -X POST http://127.0.0.1:3988/api/dashboard/system/presence \
  -H 'Content-Type: application/json' \
  -d '{"id":"research-download","title":"下载完成","summary":"研究资料已保存","detail":"共 12 个文件，1.8 GB\n保存位置：资料库 / 本周","icon":"✓","durationMs":12000}'
```

`title` 与 `summary` 必填；`detail`、`icon`、`id`、`durationMs` 可选，但持续更新的程序必须固定传入 `id`，否则每次请求都会生成新的实例。展示时长限制为 3–60 秒，默认 12 秒；相同 `id` 的每次 POST 都会从头刷新该实例的有效期，但不会改变槽位。程序停止上报后，实例在最后一次 POST 的有效期结束时自动消失；已过期的 `id` 再次出现时按新实例重新分配槽位。

发送 `DELETE /api/dashboard/system/presence/<id>` 可立即删除指定实例，发送 `DELETE /api/dashboard/system/presence` 可清空全部实例。接口只监听 `127.0.0.1`，不对局域网开放。

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

界面随构建附带 DM Sans、IBM Plex Mono、Noto Serif SC、Noto Sans SC 和霞鹜文楷字体，离线启动无需单独安装字体。保留原有系统字体的优先顺序，并为 Windows 缺失的字体提供本地回退；字体许可证随程序保存于 `dist/font-licenses/`，源码副本位于 `public/font-licenses/`。

Windows 使用隐藏的常驻 PowerShell 5.1 采集进程，展示页和控制页共享采样，不会每次轮询都新开终端。网络与磁盘速率从系统性能计数器读取，GPU 使用最忙引擎的占用率；有 NVIDIA 工具时同时读取独显温度、显存与功耗，核显更忙时显示核显负载。缺少驱动提供的温度、功耗等指标仍显示 `—`。系统媒体会话支持中文曲名、播放/暂停筛选和时间轴进度；媒体接口要求 Windows 10 1809 或更高版本。

## 当前验证范围

已在 Ubuntu 完成 TypeScript/Vite 构建、Linux AppImage 打包和 700×1120 CSS px 浏览器预览。AppImage 约 113 MB；开发预览中，Electron 主进程及直接子进程的一次 RSS 采样合计约 418 MiB。该采样包含共享页的重复计数，不等于实际独占内存；目标副屏上的长期占用仍需实测。

2026-10-03 在 Windows 11 完成构建、NSIS 安装包生成，以及开发可执行程序和打包可执行程序的实测。竖屏副屏为 934×1494 DIP、150% 缩放、90° 旋转；已确认全屏位置、控制页连接、模式切换、副屏关闭/重开、CPU/RAM/GPU/网络/磁盘采集、中文媒体元数据、长音频时间轴和暂停过滤。通过浏览器字体接口检查了本地字体加载，并检查实际时钟和标签渲染字体。Windows 屏幕参数变更、自启注册参数和 Linux 原有定位流程有回归测试；安装/卸载流程、真实热插拔与旋转切换、登录重启和长期运行仍需实测。

可复现检查命令（桌面检查会自动启动并关闭测试实例，请先退出现有 Dashboard）：

```powershell
npm run test:windows
npm run build
& .\node_modules\electron\dist\electron.exe .\tests\smoke-windows.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\smoke-windows-media.ps1
npm run package:windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\smoke-windows-package.ps1
```

桌面检查的文件日志及截图位于 `release/windows-smoke/`。媒体检查创建临时静音会话，结束后自动关闭；不会修改现有播放器。

## 许可证

本项目采用 GNU AGPL v3 或更高版本（AGPL-3.0-or-later），详见 [LICENSE](LICENSE)。

Copyright (c) 2026 Ruixiao Guo (Griffxen), College of Engineering, Peking University, Undergraduate.

允许使用、修改与商业使用，但须遵守 AGPL 的源码提供、版权声明保留等要求。修改版通过网络提供交互服务时，应按第 13 条向远程用户提供获取对应源码的方式。详见 [版权声明](LICENSE) 和 [许可证说明](LICENSE)。
