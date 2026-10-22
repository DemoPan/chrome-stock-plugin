# 🛠️ DevTools Code Linter & Memory Profiler

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue.svg)](https://developer.chrome.com/docs/extensions)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/migrating/to-manifest-v2)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 一个轻量级、低对比度的静态分析工具和运行时内存监控扩展，专为需要深度代码检查和无缝多任务处理的开发者设计。

---

## 🕵️‍♂️ 功能特性

- **IDE 视觉伪装**：完美复刻 VS Code Dark+ 主题代码配置文件，避免高对比度警报或显眼的亮色 UI 元素。
- **多节点自选列表**：支持同时监控多个运行时的内存符号/模块。
- **拼音/缩写即时索引**：自动将公司名解析为整洁统一的大写缩写（如 `ZJKY`、`GZMT`），代码块中没有干扰的中文字符。
- **防窥视失焦打码**：当扩展程序窗口失去焦点时，自动将敏感的指标数值替换为 `...`。
- **悬停轨迹检查**：鼠标悬停在任意行上即可瞬间显示完整实体名称，或者悬停在微型折线图上查看跨时间节点的轨迹。
- **老板键集成**：提供即时紧急切换快捷键（`ESC` 键或点击标签页 `×`），瞬间切换为静态的系统级 C++ 守护进程脚本。

---

## 📁 项目结构

```text
code-linter-ext/
├── manifest.json       # 扩展配置文件与权限钩子
├── popup.html          # IDE 风格编辑器界面与画布
├── style.css           # 低对比度语法高亮与布局
└── popup.js            # 实时数据同步引擎与交互逻辑
```

## 🚀 安装与设置

- 下载或克隆 本仓库到本地计算机。
- 打开谷歌浏览器 (Chrome)，访问 chrome://extensions/。
- 打开右上角的 开发者模式 (Developer mode) 开关。
- 点击左上角的 加载已解压的扩展程序 (Load unpacked)，选择你的 code 文件夹。
- 将扩展程序固定到工具栏，以便在调试期间快速访问。
