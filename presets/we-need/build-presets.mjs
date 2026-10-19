import fs from "node:fs";

const YML = "./we-need/cordis.patch.yml";
const COMPILED = "C:/Users/<you>/.dsh/profiles/desktop/cordis.yml";
const compiled = fs.readFileSync(COMPILED, "utf8");

/** 从编译后的 cordis.yml 提取某个 preset 的 plugins 段（原样，保留缩进） */
function extractPlugins(presetId, nextPresetId) {
  const startMark = `- id: ${presetId}\n`;
  const endMark = nextPresetId ? `- id: ${nextPresetId}\n` : "##END##";
  const s = compiled.indexOf(startMark);
  if (s < 0) throw new Error(`找不到 preset ${presetId}`);
  const e = nextPresetId ? compiled.indexOf(endMark, s) : compiled.length;
  if (e < 0) throw new Error(`找不到 ${nextPresetId}`);
  const block = compiled.slice(s, e);
  const pIdx = block.indexOf("    plugins:\n");
  if (pIdx < 0) throw new Error(`${presetId} 无 plugins`);
  let plugins = block.slice(pIdx + "    plugins:\n".length);
  return plugins.replace(/\n+$/, "\n");
}

/** 生成锚点行 */
function anchorRows(pad, tag) {
  const p = " ".repeat(pad);
  return [
    `${p}- id: fengcha-anchor`,
    `${p}  name: '@local/dsh-we-need'`,
    `${p}  config:`,
    `${p}    mode: head+tail`,
    `${p}    headSlot: 'anchor:${tag}:head'`,
    `${p}    tailSlot: 'anchor:${tag}:tail'`,
    `${p}    headOrder: 1`,
    `${p}    tailOrder: 10000`,
  ].join("\n");
}

/** 在 plugins 段里 agent-instructions 之前插入锚点，并把整体缩进对齐到 targetPad */
function withAnchor(plugins, tag, targetPad) {
  // 原始编译配置里 plugins 列表项的缩进（通常是 6）
  const m = plugins.match(/^( *)- id: agent-instructions$/m);
  if (!m) throw new Error("找不到 agent-instructions");
  const srcPad = m[1].length;
  const shift = targetPad - srcPad;

  // 先整体平移缩进
  let shifted = plugins
    .split("\n")
    .map((line) => {
      if (line.trim() === "") return line;
      if (shift > 0) return " ".repeat(shift) + line;
      if (shift < 0) return line.slice(Math.min(-shift, line.match(/^ */)[0].length));
      return line;
    })
    .join("\n");

  // 平移后再插入锚点
  const mm = shifted.match(/^( *)- id: agent-instructions$/m);
  const idx = shifted.indexOf(mm[0]);
  return shifted.slice(0, idx) + anchorRows(mm[1].length, tag) + "\n" + shifted.slice(idx);
}

// 提取：standard 段（到 preset-ptc 为止）、ptc 段（到 preset-minimal 为止）
const stdPlugins = extractPlugins("preset-standard", "preset-ptc");
const ptcPlugins = extractPlugins("preset-ptc", "preset-minimal");

console.log("standard 原始插件条目:", (stdPlugins.match(/^ *- id: /gm) ?? []).length);
console.log("ptc 原始插件条目:", (ptcPlugins.match(/^ *- id: /gm) ?? []).length);

// 目标层级：patch 里 `- insert:` 在 0，`    - id: preset-...` 在 4，`        plugins:` 在 8，
// 所以 plugins 的子项在第一层是 10 空格。
const stdNew = withAnchor(stdPlugins, "route", 10);
const ptcNew = withAnchor(ptcPlugins, "ptc", 10);

const HEADER = `# 风插 · 双锚点预设（head + tail）
#
# ══ 推导链（每一步都有实测支撑）══
#
# ① 句子类型：形式指令 > 吸引子（真实 wire, effort=max, 100 并发, n=90）
#      F 形式指令  纯 We 50%，均 We 占比 0.796
#      A 吸引子    纯 We  0%，均 We 占比 0.057  ≈ 无锚点（0.016）
#    ⇒ 必用「每段必须以 We 开头」这类可检查的形式约束，不用「团队身份」叙事。
#
# ② 粒度：段落级 > 块级
#      块级约束（whole block stays...）        纯 We 10%
#      加 "Every paragraph must begin with..."  纯 We 60%
#    ⇒ 已写入锚点文本。
#
# ③ 位置：快照内部【头尾各一份】（本轮核心改动）
#      仅末尾（v1 现状）  均 We 占比 0.563
#      仅开头             0.681
#      中间               0.594
#      头尾各一份         0.813   ← 采用
#      无锚点             0.032
#    原因：runtime-context 快照每 step 重渲染，其他段落一直在变，
#          单个尾部锚点被淹没在变化内容之后。
#    ⇒ mode: head+tail（headOrder 1 / tailOrder 10000）
#
#    ⚠ 该实验每组 n=10，方向可信、精确值不可外推。
#
# ④ system prompt 侧没有杠杆（真实 wire 实测，均 We 占比）
#      persona 改 We 身份   0.012
#      全量 you→we 重写     0.018
#      头/尾插入 We 段落    0.013 / 0.014
#      基线                 0.014
#    ⇒ 不动 system prompt。
#
# ⑤ wire 层位置：不要挪到 skill-catalog / time-context 之后
#      锚点→skill→time（现状）  0.886
#      skill→time→锚点（最后）   0.818
#    ⇒ 保持 runtime-context 的默认追加位置。
#
# ⑥ 重注入：快照每 step 重算，天然每轮/每步重注入，无需额外机制。
#    （RuntimeContextProjection 仅在渲染结果变化时才 commit 新消息，
#      所以内容不变的步骤不产生新消息——这是框架行为，不是缺陷。）
#
# ══ 两个预设 ══
#   fengcha-route   标准能力 + 双锚点
#   fengcha-ptc     PTC 能力 + 双锚点
# 两者都从编译后的官方 preset 原样克隆，唯一差异是多挂一个 @local/dsh-we-need 行。
#
# 安装：plugin_manager install_bundle target=F:\\风插2.0\\we-need
# 重启 DSH → 新会话选「风插 · 路由」或「风插 · PTC」。

- insert:
    - id: preset-fengcha-route
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: fengcha-route
        name: 风插 · 路由
        description: >-
          标准能力 + 头尾双锚点。段落级形式约束维持第一人称复数语域。
        order: 1
        plugins:
${stdNew}
    - id: preset-fengcha-ptc
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: fengcha-ptc
        name: 风插 · PTC
        description: >-
          PTC 能力 + 头尾双锚点。段落级形式约束维持第一人称复数语域。
        order: 2
        plugins:
${ptcNew}`;

fs.writeFileSync(YML, HEADER);
console.log("written lines:", HEADER.split("\n").length);

// 校验：对比官方原始条目集合
function idsOf(plugins) {
  return [...plugins.matchAll(/^( *)- id: ([\w-]+)$/gm)].map(m => m[2]);
}
const stdIds = idsOf(stdNew);
const ptcIds = idsOf(ptcNew);
console.log("\n标准版条目:", stdIds.length);
console.log("  ", stdIds.join(", "));
console.log("\nPTC 版条目:", ptcIds.length);
console.log("  ", ptcIds.join(", "));

// 关键：确认官方条目都在
const stdOrig = idsOf(stdPlugins);
const ptcOrig = idsOf(ptcPlugins);
const missingStd = stdOrig.filter(x => !stdIds.includes(x));
const missingPtc = ptcOrig.filter(x => !ptcIds.includes(x));
console.log("\n标准版缺失:", missingStd.length ? missingStd : "无");
console.log("PTC 版缺失:", missingPtc.length ? missingPtc : "无");
