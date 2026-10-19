/**
 * we-need anchor — runtime-context entries that anchor the reasoning register
 * to the first-person plural.
 *
 * Why a runtime-context entry rather than a system-prompt section:
 * measured on the real standard-mode wire (13,099-char system prompt, real
 * tool schemas), the same sentence scored
 *
 *   runtime-context tail       P(We) = 0.742
 *   skill-catalog tail         P(We) = 0.728
 *   time-context head          P(We) = 0.704
 *   system-prompt tail         P(We) = 0.641
 *   real user message tail     P(We) = 0.330
 *   no anchor                  P(We) = 0.004
 *
 * Order 10000 places the tail entry after engram:relay (9997) and after every
 * official context (sandbox 110, approval 115): effectively the snapshot tail.
 *
 * ## Head+tail (v2)
 *
 * The runtime-context snapshot is re-rendered every step and its *other*
 * sections change constantly, so a single tail anchor sits behind a wall of
 * churn. Measured inside the snapshot itself (real wire, effort=max, 100
 * concurrent, n=10/position):
 *
 *   head+tail        0.813 mean We-ratio   <- chosen
 *   head only        0.681
 *   mid              0.594
 *   tail only        0.563                <- v1 behaviour
 *   no anchor        0.032
 *
 * So this plugin registers the same text twice: once at the head of the
 * snapshot (order 1) and once at the tail (order 10000). Two distinct slot
 * names are used so the merged layer does not collide them.
 *
 * ## Per-row configuration
 *
 * Each mounted instance must use distinct slot names. When the same preset
 * package is mounted by several presets in one process, a shared name makes
 * the second registration collide in the merged layer and the whole preset
 * fails to activate. `headSlot` / `tailSlot` in the row config avoid that.
 *
 * The text is a compile-time constant by default on purpose: any per-turn
 * variation would invalidate prompt caching for every message after it.
 *
 * @module dsh-fengcha
 */

/** Cordis plugin name, as the preset row expects it. */
export const name = "we-need-anchor";

/** The prompt registry this row contributes to. */
export const inject = ["systemPrompt"];

/** The anchoring sentence (paragraph-level formal constraint). */
const ANCHOR_TEXT =
  'We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let\'s. ' +
  'We never write "Let me", "I", "I\'ll", "I\'ve", or "my" anywhere inside a reasoning block. ' +
  'Every paragraph must begin with "We" or "Our". ' +
  'This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".';

/** Snapshot-head order: before sandbox (110) / approval (115) / engram (9997). */
const HEAD_ORDER = 1;

/** Snapshot-tail order: after engram:relay (9997), after all official contexts. */
const TAIL_ORDER = 10000;

/** Default slot names; override per row to keep presets isolated. */
const DEFAULT_HEAD_SLOT = "anchor:we-need:head";
const DEFAULT_TAIL_SLOT = "anchor:we-need:tail";

/**
 * Register the anchor entries in the mounting scope (an agent preset's scope).
 *
 * @param ctx - a scoped context carrying `systemPrompt`.
 * @param config - optional overrides:
 *   `{ text?, headOrder?, tailOrder?, headSlot?, tailSlot?, mode? }`.
 *   `mode: "head+tail" | "head" | "tail"` selects which entries mount
 *   (default `"head+tail"`).
 */
export function apply(ctx, config = {}) {
  const text =
    typeof config.text === "string" && config.text.length > 0 ? config.text : ANCHOR_TEXT;
  const headOrder = Number.isFinite(config.headOrder) ? config.headOrder : HEAD_ORDER;
  const tailOrder = Number.isFinite(config.tailOrder) ? config.tailOrder : TAIL_ORDER;
  const headSlot =
    typeof config.headSlot === "string" && config.headSlot.length > 0
      ? config.headSlot
      : DEFAULT_HEAD_SLOT;
  const tailSlot =
    typeof config.tailSlot === "string" && config.tailSlot.length > 0
      ? config.tailSlot
      : DEFAULT_TAIL_SLOT;
  const mode = typeof config.mode === "string" ? config.mode : "head+tail";

  const entries = [];
  if (mode === "head+tail" || mode === "head") entries.push({ slot: headSlot, order: headOrder });
  if (mode === "head+tail" || mode === "tail") entries.push({ slot: tailSlot, order: tailOrder });

  for (const { slot, order } of entries) {
    ctx.effect(
      () =>
        ctx.systemPrompt.context({
          name: slot,
          order,
          text,
        }),
      `we-need: runtime-context entry (${slot} @ ${order})`,
    );
  }
}
