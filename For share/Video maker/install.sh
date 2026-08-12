#!/bin/sh
# Установка скилла Video Maker под ключ.
#
# Ставит зависимости, собирает движок, кладёт скилл в Claude Code и прописывает
# путь. Ничего не ставит молча: без --yes только печатает план.
#
#   sh install.sh          — показать, что будет сделано
#   sh install.sh --yes    — сделать
#
# Скрипт идемпотентен: повторный запуск не ломает уже установленное.

set -e

YES=0
[ "$1" = "--yes" ] && YES=1

SKILL_DIR="$HOME/.claude/skills/video-maker"
HERE=$(cd "$(dirname "$0")" && pwd)
ENGINE="$HERE/engine"

OS=$(uname -s)
ARCH=$(uname -m)

say() { printf '%s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

say "Video Maker — установка"
say "Система: $OS $ARCH"
say ""

# ── Чего не хватает ──────────────────────────────────────────────────────────
MISSING=""
have node || MISSING="$MISSING node"
have ffmpeg || MISSING="$MISSING ffmpeg"
have python3 || MISSING="$MISSING python3"

# Распознаватель речи: любой из двух. На Apple Silicon быстрее mlx.
ASR=""
have mlx_whisper && ASR="mlx_whisper"
[ -z "$ASR" ] && have whisper && ASR="whisper"
if [ -z "$ASR" ]; then
  if [ "$OS" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then
    ASR_PKG="mlx-whisper"
  else
    ASR_PKG="openai-whisper"
  fi
fi

say "Что нужно поставить:"
[ -n "$MISSING" ] && say "  системные пакеты:$MISSING" || say "  системные пакеты: всё на месте"
[ -z "$ASR" ] && say "  распознаватель речи: $ASR_PKG (pip)" || say "  распознаватель речи: $ASR уже есть"
say "  зависимости движка: npm install в $ENGINE"
say "  скилл: копия SKILL.md в $SKILL_DIR"
say ""

if [ "$YES" -ne 1 ]; then
  say "Это только план. Запусти с флагом, чтобы выполнить:"
  say "  sh install.sh --yes"
  exit 0
fi

# ── Системные пакеты ─────────────────────────────────────────────────────────
if [ -n "$MISSING" ]; then
  if [ "$OS" = "Darwin" ]; then
    have brew || { say "ОШИБКА: нет Homebrew. Поставь его с https://brew.sh и запусти снова."; exit 1; }
    say "Ставлю через brew:$MISSING"
    # shellcheck disable=SC2086
    brew install $MISSING
  elif have apt-get; then
    say "Ставлю через apt:$MISSING"
    # shellcheck disable=SC2086
    sudo apt-get update && sudo apt-get install -y $MISSING
  else
    say "ОШИБКА: поставь сам и запусти снова:$MISSING"
    exit 1
  fi
fi

# ── Распознаватель речи ──────────────────────────────────────────────────────
if [ -z "$ASR" ]; then
  say "Ставлю распознаватель речи: $ASR_PKG (это несколько минут)"
  python3 -m pip install --user "$ASR_PKG" || {
    say "ОШИБКА: не удалось поставить $ASR_PKG."
    say "Попробуй вручную: python3 -m pip install $ASR_PKG"
    exit 1
  }
fi

# ── Движок ───────────────────────────────────────────────────────────────────
say "Ставлю зависимости движка …"
cd "$ENGINE"
npm install --no-audit --no-fund
say "Прогоняю тесты …"
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)" || true

# ── Скилл в Claude Code ──────────────────────────────────────────────────────
mkdir -p "$SKILL_DIR"
cp "$HERE/SKILL.md" "$SKILL_DIR/SKILL.md"

# Путь к движку прописывается автоматически: раньше это был ручной шаг, и
# человек про него забывал — Claude потом не находил скрипты.
python3 - "$SKILL_DIR/SKILL.md" "$ENGINE" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); engine = sys.argv[2]
s = p.read_text()
s = s.replace('Движок: `engine/` рядом с этим файлом.', f'Движок: `{engine}`')
p.write_text(s)
PY

say ""
say "Готово."
say "  скилл:  $SKILL_DIR/SKILL.md"
say "  движок: $ENGINE"
say ""
say "Проверь: открой Claude Code и напиши «собери ролик из видео <путь к файлу>»."
