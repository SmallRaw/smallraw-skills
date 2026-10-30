# Codex Visual GC (Codex 智能视觉上下文垃圾回收与带宽守护者)

**Codex Visual GC** 是专为 **OpenAI Codex** 深度定制的会话媒体垃圾回收（GC）与带宽守护插件。

解决 Codex 在多轮看图、长线交互以及 **Computer Use** 过程中，由于历史 Base64 媒体反复全量重传，导致网络上传暴涨至数十 GB、会话严重卡顿的架构级痛点。

---

## 🌟 核心机制

```
[源头：截屏直压 (Pre-compression)]
  macOS 原生 sips 内存管道压至 80KB ~ 120KB JPG（节省 90% 流量）
           │
           ▼
[交互：自由图码混排 (Natural Vision & Code)]
  模型实时看图写代码，零限制、无死板规约、上下文不割裂
           │
           ▼
[末端：滑动窗口智能 GC (Sliding-Window Visual GC)]
  每轮 turn 结束自动触发：
  超过阈值（如 20MB）时，自动剥离最早的 4/5 历史旧图为 1 像素占位符；
  永久保留最新的 1/5 画面，保证视觉工作流连贯、永不失忆！
```

---

## 🚀 快速安装

在当前目录执行：

```bash
./scripts/install.sh
```

该脚本会自动完成：
1. 在 `~/.codex/visual_gc.json` 初始化用户配置文件；
2. 在 `~/.codex/turn-ended-hook.sh` 安全挂载后台 GC 引擎；
3. 执行一次全量既有会话扫描与瘦身。

---

## ⚙️ 灵活参数调整

编辑 `~/.codex/visual_gc.json`，改动立即生效：

| 参数项 | 默认值 | 作用说明 |
| :--- | :---: | :--- |
| `gc.threshold_mb` | `16` | 触发 GC 的单个会话 Base64 体积阈值（MB） |
| `gc.prune_ratio` | `0.85` | 清理比例（`0.85` 即裁旧 85%，保留最新 15%） |
| `gc.min_keep_images` | `2` | 最少必须保留的最新图片张数（防视觉断层） |
| `gc.min_image_bytes` | `100000` | 识别为大图的最小阈值（字节），不误伤小图标 |
| `capture.max_dimension`| `1280` | 实机截屏工具长边最大像素 |
| `capture.jpeg_quality` | `70` | 截屏压缩质量（70% 质量兼顾 OCR 与体积） |

---

## 🛠 命令行工具

```bash
# 查看并全量扫描清理
python3 scripts/gc_engine.py --sweep-all

# 模拟查看（不实际写盘）
python3 scripts/gc_engine.py --sweep-all --dry-run

# 使用临时参数清理
python3 scripts/gc_engine.py --sweep-all --threshold-mb 16 --prune-ratio 0.8
```

---

## 🧹 卸载

```bash
./scripts/uninstall.sh
```
一键干净解除 hook 挂载，不留任何残留。
