---
name: codex-visual-gc
description: "Codex 专属智能视觉上下文与带宽守护插件：自动回收历史超重 Base64 图片，杜绝多轮看图与 Computer Use 流量爆炸"
user-invocable: true
---

# Codex Visual GC

专为 OpenAI Codex 深度定制的会话媒体垃圾回收（GC）与带宽守护插件。

## 解决的核心问题

Codex 使用无状态 API，每轮交互都会将整个会话历史（包括以往所有的 Base64 图片）全量重新打包上传。在 Computer Use 或多轮看图工作中，几十张截图会导致每次请求重传上百兆数据，几天内烧掉数十 GB 流量。

本插件通过两道防线彻底解决该问题：
1. **源头极速预压缩**：通过 macOS 原生 `sips`，将截屏无损转为 70% 质量的 JPEG（体积由 1.6MB 骤降至 80KB，降幅达 90%）；
2. **后台智能滑动 GC**：每轮对话结束时，自动监控会话图片体积。当超过阈值时，自动将**最早的 4/5 历史旧图**替换为 1 像素占位符，**保留最新 1/5 的即时画面**，保持最新视觉感知不断层，会话底包彻底锁定在安全线内。

## 配置与调参

配置文件位于 `~/.codex/visual_gc.json`（或项目级 `config.json`），随时修改即时生效：

```json
{
  "version": "1.0.0",
  "gc": {
    "enabled": true,
    "threshold_mb": 16,       // 触发 GC 的体积阈值（MB）
    "prune_ratio": 0.85,      // 裁剪比例：0.85 即裁前 85%，留最新 15%
    "min_keep_images": 2,     // 保证最新图片至少保留张数
    "min_image_bytes": 100000 // 识别为大图的最小阈值（100KB）
  },
  "capture": {
    "max_dimension": 1280,    // 截屏长边最大分辨率
    "jpeg_quality": 70        // 截屏压缩质量
  }
}
```

## 命令行手动管理

```bash
# 全局扫描清理所有已有超重会话
python3 <skill-dir>/scripts/gc_engine.py --sweep-all

# 模拟运行（不修改文件，仅查看回收效果）
python3 <skill-dir>/scripts/gc_engine.py --sweep-all --dry-run

# 自定义阈值临时清理
python3 <skill-dir>/scripts/gc_engine.py --sweep-all --threshold-mb 16 --prune-ratio 0.8
```
