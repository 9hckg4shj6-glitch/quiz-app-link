#!/bin/zsh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。Node.js をインストールしてから再実行してください。"
  exit 1
fi

npm run build || exit 1
node server.js
