#!/usr/bin/env bash
# 风插预设 · 一键安装 / 回退
# 用法：
#   bash install.sh                  # 安装
#   bash install.sh --uninstall      # 卸载
#   bash install.sh --revert-patch   # 仅回退 patch 到改动前版本
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_NAME="@local/dsh-we-need"
PROFILE="${DSH_PROFILE:-$HOME/.dsh/profiles/desktop}"

info() { printf '\033[36m[风插]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[风插]\033[0m %s\n' "$*"; }
err()  { printf '\033[31m[风插]\033[0m %s\n' "$*" >&2; }

# ── 前置检查 ──────────────────────────────────────────────────────
check() {
  if [ ! -d "$PROFILE" ]; then
    err "找不到 DSH profile 目录：$PROFILE"
    err "请用 DSH_PROFILE=/path/to/profile 指定，或确认 DSH Desktop 已安装并至少启动过一次。"
    exit 1
  fi
  if [ ! -f "$PKG_DIR/package.json" ]; then
    err "当前目录不像一个包（缺 package.json）：$PKG_DIR"
    exit 1
  fi
  if [ ! -f "$PKG_DIR/cordis.patch.yml" ]; then
    err "缺 cordis.patch.yml"
    exit 1
  fi
  if [ ! -f "$PKG_DIR/lib/index.js" ]; then
    err "缺 lib/index.js"
    exit 1
  fi
  info "profile: $PROFILE"
  info "package: $PKG_DIR"
}

# ── 编辑 package.json（node 实现，避免 jq 依赖）────────────────────
edit_pkg() {
  local mode="$1"   # add | remove
  node - "$PROFILE/package.json" "$mode" "$PKG_NAME" "$PKG_DIR" <<'NODE'
const fs = require("node:fs");
const [file, mode, name, dir] = process.argv.slice(2);
if (!fs.existsSync(file)) {
  console.error("找不到 " + file);
  process.exit(1);
}
let pkg;
try { pkg = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (e) { console.error("package.json 解析失败：" + e.message); process.exit(1); }

pkg.dependencies ??= {};
pkg.dsh ??= {};
pkg.dsh.profile ??= {};
pkg.dsh.profile.bundles ??= [];

const depValue = "link:" + dir.replace(/\\/g, "/");

if (mode === "add") {
  pkg.dependencies[name] = depValue;
  if (!pkg.dsh.profile.bundles.includes(name)) pkg.dsh.profile.bundles.push(name);
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log("已写入 dependencies + bundles");
} else {
  delete pkg.dependencies[name];
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== name);
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log("已从 dependencies + bundles 移除");
}
NODE
}

# ── 建/删链接 ─────────────────────────────────────────────────────
link_pkg() {
  local target="$PROFILE/node_modules/@local/dsh-we-need"
  mkdir -p "$(dirname "$target")"
  if [ -e "$target" ] || [ -L "$target" ]; then
    info "已存在，先移除旧链接：$target"
    rm -rf "$target"
  fi
  # Windows：优先用 cmd 的 mklink /J（junction，不需管理员权限）。
  # 注意：必须先把两个路径都转成 Windows 形式，且判据是「目标真的出现了」，
  # 不能只看命令退出码——git-bash 下 cmd.exe 的返回码不可靠。
  if command -v cygpath >/dev/null 2>&1; then
    local winTarget winSrc
    winTarget="$(cygpath -w "$target")"
    winSrc="$(cygpath -w "$PKG_DIR")"
    cmd.exe /c mklink /J "$winTarget" "$winSrc" >/dev/null 2>&1 || true
    if [ -e "$target" ]; then
      info "junction 创建成功"
      return
    fi
    warn "mklink 失败，回退到符号链接"
  fi
  ln -sfn "$PKG_DIR" "$target"
  if [ -e "$target" ]; then
    info "符号链接创建成功"
  else
    err "链接创建失败：$target"
    err "请手动执行（管理员 CMD）："
    err "  mklink /J \"$(cygpath -w "$target" 2>/dev/null || echo "$target")\" \"$(cygpath -w "$PKG_DIR" 2>/dev/null || echo "$PKG_DIR")\""
    exit 1
  fi
}

unlink_pkg() {
  local target="$PROFILE/node_modules/@local/dsh-we-need"
  # junction 在 msys 里可能表现为目录，也可能是符号链接；两种都处理
  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -rf "$target"
    info "已移除链接：$target"
  else
    warn "链接不存在，跳过"
  fi
  rmdir "$PROFILE/node_modules/@local" 2>/dev/null || true
}

# ── 主流程 ────────────────────────────────────────────────────────
case "${1:-}" in
  --uninstall)
    check
    info "卸载中……"
    edit_pkg remove
    unlink_pkg
    info "完成。重启 DSH 后生效。"
    ;;
  --revert-patch)
    check
    BAK="$PKG_DIR/archive/cordis.patch.yml.bak-before-headtail"
    if [ ! -f "$BAK" ]; then
      err "找不到备份：$BAK"
      err "可用备份："
      ls -1 "$PKG_DIR/archive/" 2>/dev/null || err "  archive/ 目录不存在"
      exit 1
    fi
    cp "$BAK" "$PKG_DIR/cordis.patch.yml"
    info "已回退 cordis.patch.yml → $(basename "$BAK")"
    info "重启 DSH 后生效。"
    ;;
  ""|--install)
    check
    # 备份 profile package.json
    BAK="$PROFILE/package.json.bak-fengcha-$(date +%Y%m%d-%H%M%S)"
    cp "$PROFILE/package.json" "$BAK"
    info "已备份 profile/package.json → $(basename "$BAK")"

    edit_pkg add
    link_pkg

    echo
    info "安装完成。"
    info ""
    info "下一步："
    info "  1. 重启 DSH"
    info "  2. 新开一个会话（已开会话不受影响）"
    info "  3. 在预设列表中选择「风插标准」或「风插 PTC」"
    info ""
    info "回退："
    info "  bash $0 --revert-patch    # 只回退 patch 内容"
    info "  bash $0 --uninstall       # 完全卸载"
    ;;
  *)
    err "未知参数：$1"
    echo "用法：bash install.sh [--install | --uninstall | --revert-patch]"
    exit 1
    ;;
esac
