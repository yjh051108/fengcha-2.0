# 风插 2.0

> **让模型在思考时更多说「我们来……」（We need / Our），而不是「我来……」（Let me / I）。**
>
> 这是一个 DeepSeek Harness（DSH）的预设。装上之后，你会在模型的「思考过程」里
> 看到更多 `We need to check...` 这样的开头。
>
> **它不保证让模型变聪明。** 我们测的是「思考时用哪种口吻」，没测「答得对不对」。
> 详见下方 [这份方案能做什么、不能做什么](#这份方案能做什么不能做什么)。

---

## 30 秒版本

```bash
git clone https://github.com/yjh051108/fengcha-2.0
cd fengcha-2.0/presets/we-need
bash install.sh
# 重启 DSH → 新开一个会话 → 在预设列表里选「风插标准」
```

想撤销：`bash install.sh --uninstall`（或 `--revert-patch` 只回退配置）。

**只想要效果、不关心原理的人，看到这里就够了。**

---

## 这份方案能做什么、不能做什么

### 能

让模型的思考口吻从「我来算一下」变成「我们需要算一下」。实测（下面有数据）：
思考块里出现「我们」类词的比例，从 **3%** 提升到 **81%**。

### 不能

- ❌ **不能保证答得更对。** 我们没测正确率、没测代码质量、没测速度、
  没测花多少钱。**一句都没有。**
- ❌ **不能保证没有副作用。** 强制模型按某种格式说话，可能会分散它的注意力。
  这个代价我们没量化。
- ❌ **不是「发现了某种神奇提示词」。** 见下方 [为什么这不是玄学](#为什么这不是玄学)。

如果你看到有人说「这个能让模型变强」，**那是他说的，不是我们说的**。
我们的证据只支持「思考口吻变了」。

---

## 它到底是怎么起作用的（人话版）

模型每次思考前，会先读到一段「当前环境说明」——里面写着沙箱权限、
当前时间、可用工具之类。这段说明每个步骤都会重新生成一遍。

我们在**这段说明的最前面**和**最后面**，各塞进同样一句话：

> 每次思考都要以「We need」开头。整段思考保持第一人称复数：We / Our / Let's。
> 不要写「Let me」「I」「my」。每一段都要以「We」或「Our」开头。

**为什么要放两遍？** 因为这段说明本身很长（1000-3000 字），而且每次都在变。
只放在最后面的话，前面那些变化的内容会把这句话「淹没」，模型容易忽略它。
实测放两遍比放一遍效果好（0.81 vs 0.56，数字含义见下节）。

**为什么不用更「自然」的说法？** 我们试过。比如写「我们是一个团队，一起思考，
没有旁观者」这种有感染力的描述——结果**几乎没用**，和什么都不写几乎一样（0.13 vs 0.02）。
模型只认「可以逐条检查的硬规定」，不认「氛围描述」。

---

## 效果数据

### 怎么读这些数字

我们数每个「思考块」里出现了多少「我们」类词（We / Our / Us / Let's），
和多少「我」类词（Let me / I / my），算一个比例：

- **1.0** = 整段全是「我们」
- **0.0** = 整段全是「我」
- **0.5** = 一半一半

下文所有「We 占比」都是这个意思。

### 一句话放在哪，效果差很多

| 那句话放的位置 | We 占比 |
|---|---|
| **开头 + 结尾各一遍（本方案）** | **0.81** |
| 只放前 1/4 处 | 0.71 |
| 只放开头 | 0.68 |
| 只放中间 | 0.59 |
| 只放结尾（上一版的做法） | 0.56 |
| 什么都不放 | 0.02 |

> 上一版只放结尾，是所有放法里**最差**的。这就是这次升级的原因。
> 图见 [charts/fig2-snapshot-position.svg](charts/fig2-snapshot-position.svg)。

### 「说得有感染力」为什么不管用

我们做了 8 种写法对照，同样是那句话，换个说法效果天差地别：

| 写法 | We 占比 |
|---|---|
| 「每一段必须以 We 或 Our 开头」（硬规定） | 0.77 |
| 「每句话必须以 We 开头」（更硬） | 0.82 |
| 「整段保持第一人称复数」（旧版，较宽松） | 0.64 |
| 「我们是一个团队，一起思考，没有旁观者」（氛围描述） | 0.13 |
| 「我们的思考发生在一体中」（氛围描述） | 0.00 |
| 什么都不写 | 0.02 |

> **结论：模型听不懂「氛围」，只认「规定」。**
> 图见 [charts/fig1-sentence-type.svg](charts/fig1-sentence-type.svg)。

### 改系统提示词有用吗？没有

我们也试过把整个系统提示词（13,000 字）改写成第一人称：
把人格从「你是编码助手」改成「我们是一个编码团队」、把所有的 "you" 换成 "we"、
在开头结尾各插一段。**全部无效**，结果和什么都不做几乎一样（0.01–0.07）。

唯一有用的是在这个「环境说明」里塞那句话（0.88）。

> **结论：说什么不重要，在哪说才重要。**
> 图见 [charts/fig3-system-prompt.svg](charts/fig3-system-prompt.svg)。

---

## 为什么这不是玄学

三条可检验的判断：

1. **我们可以复现。** `experiments/` 里 50 多个脚本，任何人都能重跑。
   数据和脚本都在仓库里，不是「我们发现了一个秘密」。

2. **我们公开了失败。** 上面那三张表里，大部分尝试是**失败的**。
   吸引力描述失败了、改系统提示词失败了、把话挪到更靠后也失败了。
   这些失败结论和成功结论一样重要——它们能帮你少走弯路。

3. **我们标了边界。** 比如「位置实验每组只有 10 个样本，
   方向可信但精确数字不可外推」这种话，写在
   [presets/we-need/README.md](presets/we-need/README.md) 里，没有藏起来。

---

## 装哪个？两个预设的区别

| | 风插标准 | 风插 PTC |
|---|---|---|
| 适合 | 日常写代码、改文件、多步任务 | 复杂工具编排、多任务并行 |
| 内容 | 官方「standard」预设的完整复制 + 那句约束 | 官方「PTC」预设的完整复制 + 那句约束 |
| 效果 | 完全一样 | 完全一样 |

**两个预设的差别只有「底层能力集」，那句话的效果完全相同。**
平时用 standard 就选「风插标准」，平时用 PTC 就选「风插 PTC」。

---

## 会不会影响我其他会话？

**不会。** 那句话只挂在「风插标准」和「风插 PTC」这两个预设里面：

- 插件写在预设的配置里，不是全局
- 不修改 DSH 本身的任何文件
- 不改其他预设

**选别的预设 → 完全没影响。** 这是结构上的保证，不是靠自觉。

---

## 仓库里有什么

```
├── presets/we-need/    预设本体 + 安装脚本 + 详细技术文档
├── charts/             8 张实验图（SVG 可缩放，PNG 可直接看）
├── experiments/        50+ 个可复跑的实验脚本
├── data/               脱敏后的实验数据（只有数字，没有对话内容）
└── scripts/            发布工具：密钥清洗 / 隐私扫描 / 图表生成 / 仓库轮询
```

---

## 已知限制（诚实清单）

1. **样本量不大。** 位置类实验每组 10 个样本。差距方向可信，精确数字不可外推。
2. **只测了一个模型。** 全部实验在 `deepseek-v4.1-flash` 上做的。
   换别的模型（v4-pro、glm、kimi）我们没测。
3. **实验环境比真实环境简单。** 我们用了真实的系统提示词和真实的工具列表，
   但**没有真实的工具调用往返**。真实使用中工具结果会不断涌入，
   效果可能不一样。
4. **生产数据是观察，不是实验。** 我们统计了 305 个真实会话（12 个带这句话、
   281 个不带），差异明显，但这**不是随机对照**，无法排除其他因素。
5. **完全没测能力。** 正确率、代码质量、延迟、费用——一个都没测。

完整方法学见 [presets/we-need/README.md](presets/we-need/README.md)。

---

## 你是开发者？看这里

### 脚本怎么用

```bash
# 重新生成预设（DSH 升级后用）
cd presets/we-need && node build-presets.mjs

# 重新生成图表
node scripts/make-charts.mjs

# 复跑某个实验（需要 d1 中转的 key）
export D1_API_KEY=你的key
node experiments/snapshot-position.mjs
```

### 仓库轮询（每小时检查新 issue / PR）

```bash
node scripts/watch-repo.mjs                    # 查一次
node scripts/watch-repo.mjs --json             # 机器可读
node scripts/watch-loop.mjs --interval 3600    # 常驻，每小时查一次
```

### 密钥说明

所有脚本从环境变量读 `D1_API_KEY`，**仓库里没有任何硬编码密钥**。
可用 `node scripts/clean-secrets.mjs . --verify` 自行验证。

---

## 许可证

[Apache License 2.0](LICENSE)

---

## English

**TL;DR:** A DeepSeek Harness preset that makes the model's *reasoning* use
"We need / Our" instead of "Let me / I". It changes how the model talks to itself.

**What it does NOT do:** we have not measured correctness, code quality, latency,
or cost. We do not claim the model gets smarter. We only measured the change in
reasoning style (3% → 81% "we"-style).

**Install:**

```bash
cd presets/we-need && bash install.sh
# restart DSH, open a new session, pick "风插标准"
```

**Why it's not a prompt trick:** we ran controlled ablations. Identity-narrative
phrasings ("we are a team thinking as one") scored 0.13 — barely above
no prompt at all (0.02). Only a checkable *formal directive* works (0.77–0.82).
The same sentence placed at the tail of the context scored 0.56; at head + tail,
0.81.

Everything is reproducible: scripts in `experiments/`, anonymized aggregates in
`data/`. Failures are documented alongside successes.

License: [Apache-2.0](LICENSE)
