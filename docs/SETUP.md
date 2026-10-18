# みんなで店決め：セットアップ・公開手順

グループで食事に行くお店を、アンケートで決める Web アプリです。
ホストが条件を決めてルームを作り、共有リンクから参加者がジャンルの好みを ◎〇× で答えると、おすすめのお店を 1〜5 位で表示します。
（店舗データは大阪・京都の架空のモック 99 件）

- **ホストが決める**: 場所・人数・日時・予算・ジャンル（居酒屋／カフェ／ご飯）・飲み放題・席の希望・テイクアウト
- **参加者が答える**: ジャンルの小カテゴリごとに ◎（+1）〇（0）×（−2）

---

## 公開手順（Neon → Render）

コードはこのリポジトリ（`jphacks/os_2617`）の `main` ブランチにあります。

### 1. Neon でデータベースを作る（無料・カード登録不要）

1. https://neon.com でサインアップ
2. 「Create project」：名前は `mise-kime`、**Region は「AWS Asia Pacific (Singapore)」**
3. 作成後の画面の「Connect」から接続文字列（`postgresql://...neon.tech/neondb?sslmode=require...`）をコピー

テーブルはアプリの起動時に自動で作られるので、Neon 側での作業はこれだけです。

### 2. Render で公開する

1. Render のダッシュボードで「New」→「Blueprint」
2. GitHub の `jphacks/os_2617` リポジトリを選ぶ
   - 一覧に出ないときは、Render の GitHub 連携の設定で `jphacks` 組織へのアクセスを追加する（組織の管理者の承認が必要な場合があります）
3. `render.yaml` の内容が表示されるので、`DATABASE_URL` に手順 1 でコピーした接続文字列を貼り付けて「Apply」（または「Deploy Blueprint」）
4. 数分でビルドが終わると `https://mise-kime-xxxx.onrender.com` のような URL で公開されます

確認: `https://（公開URL）/healthz` を開いて `"store":"postgres"` と出ればデータベースにつながっています（`memory` と出たら `DATABASE_URL` が設定されていません）。

### 公開後の修正

GitHub の `main` ブランチに push すると、Render が自動で再デプロイします（数分で反映）。
うまく動かなかったときは、Render の「Events」から前のデプロイに戻せます（Rollback）。

---

## 無料プランでの注意

- **Render（無料）**: 15 分アクセスがないと停止し、次のアクセス時に起動まで 1 分ほどかかります。毎月 750 時間まで。
- **Neon（無料）**: 5 分使われないと停止し、次のアクセス時に数秒で再開します。容量は 1 プロジェクトあたり 1GB で、このアプリの用途なら十分です。
- データは Neon に保存されるので、Render が停止・再デプロイしてもルームと回答は消えません。

## 設定（Render の「Environment」で変更）

| 変数 | 内容 |
|---|---|
| `DATABASE_URL` | Neon の接続文字列。未設定だとメモリ保存（再起動で消える） |
| `DEMO_TOOLS` | `false` にするとホスト画面の「サンプル回答を1件追加」ボタンを隠す |

---

## 手元で動かす

Node.js 22 が必要です。

```bash
npm install
npm start          # http://localhost:3000 （DATABASE_URL がなければメモリ保存）
npm test           # API の一連の流れを自動チェック
npm run demo       # ランキングの計算だけを試す（点数の内訳をコンソールに表示）
```

## 画面

| URL | 画面 |
|---|---|
| `/` | ルーム作成 |
| `/rooms/:id/host?token=…` | ホスト画面（共有リンク・回答状況・締め切り）。トークン付きURLはホストだけが持つ |
| `/r/:id` | アンケート（参加者に送る共有リンク） |
| `/rooms/:id/result` | ランキング（受付中は待機表示 → 締め切り後に自動で切り替わる） |

## API

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/options` | 選択肢（エリア・予算・ジャンル・評価など） |
| POST | `/api/rooms` | ルーム作成 `{ location, people, datetime, budget, category, nomihodai, seat, takeout }` |
| GET | `/api/rooms/:id` | ルーム情報と回答状況 |
| POST | `/api/rooms/:id/answers` | 回答 `{ name, ratings: { 小カテゴリ: "great" \| "ok" \| "ng" } }`。同じ名前は上書き。人数に達したら自動締め切り |
| POST | `/api/rooms/:id/close` | 締め切り `{ hostToken }` |
| POST | `/api/rooms/:id/sample-answer` | 動作確認用のサンプル回答 `{ hostToken }` |
| GET | `/api/rooms/:id/result` | ランキング（受付中は 409） |
| GET | `/healthz` | 死活確認 |

## ランキングの考え方（`src/ranking.js`）

1. **足切り**: ホストが選んだジャンル以外・指定エリアから 5km 超・定休日・営業時間外・人数オーバーのお店を除外
2. **採点**: 項目ごとに 0〜1 で採点し、重み付き平均で 100 点満点にする

   | 項目 | 重み | 採点 |
   |---|---|---|
   | 場所 | 30 | エリア中心からの距離で減衰（1.5km で約 0.37） |
   | 予算 | 25 | 予算帯に入っていれば満点。上振れに厳しく減点 |
   | 小カテゴリ | 20 | そのお店の小カテゴリへの ◎〇× の 1 人あたり平均（−2〜+2）を 0〜1 に換算 |
   | 飲み放題 | 10 | ホストが「必須」のときだけ。なければさらに ×0.6 |
   | 席 | 10 | ホストが席を指定したときだけ。その席があれば満点 |
   | テイクアウト | 10 | ホストが「希望する」のときだけ。非対応ならさらに ×0.6 |
   | 店の評価 | 5 | ★3.0→0、★4.5→1 |

3. **並べ替え**: 点数 → 店の評価 → 距離 の順で上位 5 件

重みやしきい値は `src/ranking.js` 冒頭の定数で調整できます。店舗データを実際の API（ホットペッパー等）に差し替えるときは `src/mockRestaurants.js` の `fetchRestaurants()` を置き換えます。

## ファイル構成

```
server.js              Express の API と画面配信
src/options.js         選択肢の定義（ジャンル・予算・◎〇× など）
src/mockRestaurants.js エリアと架空店舗データ
src/ranking.js         集計・スコアリング・ランキング生成
src/store.js           保存先（PostgreSQL / メモリ）
public/                画面（index.html / app.js / style.css）
scripts/               テストとデモ
render.yaml            Render の設定
```
