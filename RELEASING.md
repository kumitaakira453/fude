# リリース手順

fude は **`v*` タグの push をトリガーに GitHub Actions が各 OS をビルドし、
GitHub Releases に成果物と自動更新用マニフェスト (`latest.json`) を添付**する。
ユーザーは公開済み Release から直接ダウンロードでき、既存インストールは起動時に
更新通知を受け取る。

---

## TL;DR

```bash
# 1) バージョンを上げる（下記2ファイルを同じ値に）
#    package.json / src-tauri/tauri.conf.json
#    ※ src-tauri/Cargo.toml の version は上げない（固定）。
#      リリース版の値は tauri.conf.json が正。Cargo.toml を触らないことで
#      Cargo.lock が安定し、CI の Rust キャッシュが毎回ヒットして速い。
# 2) コミットしてタグを打つ（タグは v + バージョン）
git commit -am "release: v0.2.0"
git tag v0.2.0
git push origin main v0.2.0
# 3) Actions が macOS(Apple Silicon) をビルドし「ドラフト」Release を作成
# 4) Release ページで内容を確認し Publish（公開）する
```

---

## 1. バージョンを上げる

2 ファイルのバージョンを**同じ値**に揃える。`latest.json`・バンドルのバージョンは
`src-tauri/tauri.conf.json` が基準になる。

| ファイル | フィールド | 備考 |
|----------|-----------|------|
| `package.json` | `"version"` | 表示・整合用 |
| `src-tauri/tauri.conf.json` | `"version"` | **リリース版の正**（updater/バンドル） |
| ~~`src-tauri/Cargo.toml`~~ | ~~`[package] version`~~ | **上げない（固定）** |

`src-tauri/Cargo.toml` の version は**リリースごとに変更しない**。Tauri は
tauri.conf.json の version を優先するため実害はなく、Cargo.lock を安定させて
**CI の Rust キャッシュ（Cargo.lock ハッシュがキー）を毎回ヒット**させられる。
これがビルド時間短縮の要。

自動更新が「更新あり」と判定するのは **インストール済みより新しいバージョン**
のときだけなので、tauri.conf.json / package.json は必ず上げること。

## 2. タグを打って push

```bash
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z            # タグ名は tauri.conf の version に v を付けたもの
git push origin main vX.Y.Z
```

- タグ名の形式は `v*`（例 `v0.2.0`）。この形式だけがワークフローを起動する。
- タグを打たずに手動起動もできる（GitHub の Actions → Release → *Run workflow* で
  タグ名を入力）。

## 3. ビルドを待つ

`.github/workflows/release.yml` が以下をビルドする（ビルド短縮のため対象は
**macOS (Apple Silicon) 単体**）。

| OS | 成果物 |
|----|--------|
| macOS (Apple Silicon) | `.dmg` / `.app.tar.gz`（+ 署名 `.sig`） |

あわせて自動更新用の **`latest.json`** が生成され、Release に添付される。

> 他 OS（Intel mac / Windows / Linux）が必要になったら、`release.yml` を
> matrix 構成に戻して `runs-on` と `args` を各プラットフォーム分に増やす。

## 4. Release を公開する

ワークフローは **ドラフト** の Release を作る。内容（リリースノート・成果物）を
確認してから **Publish**（公開）する。

> ⚠️ 自動更新は「**公開済み**の latest リリース」しか見ない。ドラフトのままだと
> 配信されない。エンドポイントは
> `https://github.com/kumitaakira453/fude/releases/latest/download/latest.json`。

---

## 自動更新の仕組み

- 起動時に `latest.json` を取得し、記載バージョンが現行より新しければ右下に
  更新通知（`src/components/UpdateBanner.tsx`）を出す。
- 「更新して再起動」で該当プラットフォームのバイナリをダウンロード・インストール
  し、アプリを再起動する。
- 成果物は **minisign 署名**され、`tauri.conf.json` の `plugins.updater.pubkey`
  で検証される。署名が一致しない更新は適用されない。

### 署名鍵

| 用途 | 場所 |
|------|------|
| 公開鍵 | `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` にコミット済み |
| 秘密鍵（ローカル） | `~/.tauri/mdglow-updater.key`（**git 管理外**・要バックアップ） |
| 秘密鍵（CI） | GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY` |
| 鍵のパスワード | GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（今は空） |

> ⚠️ **秘密鍵を失うと、既存インストールが受け入れる更新に署名できなくなる。**
> `~/.tauri/mdglow-updater.key` を必ず安全な場所にバックアップする。

鍵を作り直す場合:

```bash
npx tauri signer generate -w ~/.tauri/mdglow-updater.key -f
# 出力された .pub の中身を tauri.conf.json の pubkey に貼り替え
gh secret set TAURI_SIGNING_PRIVATE_KEY -R kumitaakira453/fude < ~/.tauri/mdglow-updater.key
```

---

## トラブルシューティング

| 症状 | 原因 / 対処 |
|------|-------------|
| 更新通知が出ない | Release がドラフトのまま／バージョンを上げ忘れ／`latest.json` 未添付 |
| 更新の適用に失敗 | 署名不一致。CI の署名 Secrets と `pubkey` の対応を確認 |
| ワークフローが起動しない | タグが `v*` 形式でない／`main` に workflow が無い |
| macOS で「壊れている」表示 | 未署名（Apple 署名）のため。`xattr -dr com.apple.quarantine <app>` |

> Apple の公証（notarization）と、自動更新の minisign 署名は**別物**。前者は
> Gatekeeper 用、後者は updater 用。現状 Apple 署名は未対応。
