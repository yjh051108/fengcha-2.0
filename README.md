# 风插 2.0 · Fengcha 2.0

> 面向 DeepSeek Harness（DSH）的**推理语域锚定预设**。
>
> **本方案是「硬指令约束」，不是「找到了可直接实现思维链的吸引子」。**
> 它只做一件事：让模型的推理更多以第一人称复数（`We need` / `Our`）展开。
> **是否带来实际能力提升，目前没有证据；是否带来负面作用，目前也没有证据。**

[中文](#中文) · [English](#english)

---

## 中文

### 这是什么

两个 DSH agent preset：

| 预设 | preset id | 能力基底 | 用途 |
|---|---|---|---|
| **风插标准** | `fengcha-route` | 官方 `standard` 完整克隆 | 日常编码、文件操作、多步任务 |
| **风插 PTC** | `fengcha-ptc` | 官方 `ptc` 完整克隆 | 长链路工具编排、多子任务 |

两者的锚点配置**完全相同**，唯一差异是能力基底。

**结构**：每个预设 = 官方预设完整克隆 + 一条 `@local/dsh-we-need` 插件条目。
该插件在 runtime-context 快照的**头（order 1）和尾（order 10000）各注入一次**同一段形式约束文本。

### 效果（如实标注）

受控实验（真实 wire：13,099 字符 system + 152 个真实工具 schema，`reasoning_effort=max`，100 并发）：

| 配置 | 推理块中 We 类词占比 |
|---|---|
| 头尾双锚点（本方案） | **0.813** |
| 仅开头 | 0.681 |
| 中间 | 0.594 |
| 仅末尾（上一版） | 0.563 |
| 无锚点 | 0.032 |

**但请注意：** 这只说明「语域变了」，不说明「模型变强了」。
本项目**没有**测量任务正确率、代码质量、token 成本或延迟。

完整方法与限制见 [presets/we-need/README.md](presets/we-need/README.md)。

### 快速开始

```bash
git clone <this-repo>
cd 风插2.0/presets/we-need
bash install.sh          # 安装（自动备份 profile/package.json）
# 重启 DSH → 新开会话 → 选「风插标准」或「风插 PTC」
```

回退：

```bash
bash install.sh --revert-patch   # 回退 patch 内容
bash install.sh --uninstall      # 完全卸载
```

**作用域保证**：插件只挂在两个 preset 内部，不使用任何全局挂载。
不选这两个预设 → 零影响。

### 仓库结构

```
├── presets/we-need/       # 预设本体 + 安装脚本 + 详细 README
├── charts/                # 8 张实验图表（SVG + PNG）
├── experiments/           # 可复跑的实验脚本（已清密钥 / 去本地化）
├── data/                  # 脱敏后的实验数据（仅聚合指标，无对话原文）
└── scripts/               # 发布工具：图表生成 / 密钥清洗 / 隐私扫描 / 脱敏
```

### 研究结论速览

**有效的：**
- 形式指令（"每段必须以 We 开头"）：0.796
- 段落级 > 块级约束
- 快照头尾各一份 > 任何单一位置
- 每轮重注入 > 只注入一次

**无效或被证伪的：**
- 身份叙事 / 吸引子写法（"我们是团队""一体思考"）：0.057 ≈ 无锚点 0.016
- 改 system prompt（persona / 全量 you→we / 头尾插段）：全部停留在基线
- 把锚点挪到 wire 更后面：反而变差（0.818 vs 0.886）
- 更高频率重注入：已经天然是每步一次

**已修正的早期错误结论：**
- 「`We → Let me` 是棘轮、回不去」——只在锚点不重注入时成立
- 「`Let me` 思维链比 `We` 长」——块级数据相反（`We` 2,271 > `Let me` 1,906）

### 许可

[Apache License 2.0](LICENSE)

---

## English

### What this is

Two DSH agent presets that anchor the model's reasoning **register** to the
first person plural (`We need` / `Our`).

| Preset | id | Capability base |
|---|---|---|
| **Fengcha Standard** | `fengcha-route` | full clone of official `standard` |
| **Fengcha PTC** | `fengcha-ptc` | full clone of official `ptc` |

Each preset is a **complete clone** of the official preset plus one plugin row
(`@local/dsh-we-need`) that registers a single formal constraint twice: once at
the head of the runtime-context snapshot (order 1) and once at its tail (order 10000).

### What this is NOT

- **Not** an "attractor" that naturally elicits a reasoning chain. We tested
  identity-narrative variants (e.g. "we are a team, thinking as one") against
  a no-anchor baseline: **0.057 vs 0.016** — no meaningful difference.
  Only a checkable *formal directive* works (0.796).
- **Not** a capability improvement. We did **not** measure correctness, code
  quality, token cost, or latency. The register changed; nothing else is claimed.
- **Not** global. The plugin is mounted strictly inside the two presets. Pick
  any other preset and it has zero effect.

### Install

```bash
cd presets/we-need
bash install.sh
# restart DSH, open a new session, pick "风插标准" or "风插 PTC"
```

Revert: `bash install.sh --revert-patch` · Uninstall: `bash install.sh --uninstall`

### License

[Apache License 2.0](LICENSE)

---

## 数据来源与边界

| 项目 | 数值 |
|---|---|
| 真实会话语料 | 305 个会话 / 122,366 事件（已脱敏，见 `data/`） |
| 受控实验调用 | 2,000+ 次（d1 中转，`deepseek-v4.1-flash`） |
| 位置类实验样本量 | 每格 n=10（**方向可信，精确值不可外推**） |
| 生产语料对照 | 12 个带锚点会话 vs 281 对照（**自然观察，非随机对照**） |

**三个必须知道的方法学限制：**

1. **单模型**：全部实验在 `deepseek-v4.1-flash` 上完成，未验证其他模型。
2. **非真实工具往返**：受控实验提供了真实 system + 真实工具 schema，但没有
   真实的工具结果回流。真实 DSH 会话中工具结果会持续污染上下文。
3. **图 8 是自然观察**：带锚点会话来自同一天、同 provider，选择偏差无法排除。

细节见 [presets/we-need/README.md](presets/we-need/README.md) 的「已知限制」一节。

---

## 发布前清洗说明（可复核）

本仓库在发布前执行了四轮清洗，脚本都在 `scripts/` 下，可自行复跑验证：

```bash
cd <repo-root>
node scripts/clean-secrets.mjs . --verify      # 硬编码密钥：应为 0
node scripts/scan-privacy.mjs .                # 敏感路径/标识：应无 high
```

| 清洗项 | 处理方式 |
|---|---|
| 硬编码 API key（16 个文件） | 替换为 `process.env.D1_API_KEY` |
| 本机绝对路径 | 替换为 `<repo-root>` / `<you>` / `<dsh-checkout>` 占位符 |
| 真实会话 ID | 匿名化为 `session-s001` 等稳定假名 |
| 实验数据中的对话原文 | 剥离 `content`/`reasoning`/`head` 等字段，仅留聚合指标 |
| 真实会话语料、含他人 key 的抓取文件 | **未纳入仓库** |
