import { convertFileSrc } from "@tauri-apps/api/core";

// ファイルを WebView に直接読ませるための道筋。
//
// `convertFileSrc` は道筋をまるごと encodeURIComponent するので、区切りの `/`
// まで `%2F` になる。受け口は元に戻してから開くのでその 1 枚は出るが、
// ブラウザから見ると道筋が「1 つの長い名前」に潰れている。中に書かれた相対の
// 道筋が同じ階層に解けず、隣に置いた画像や CSS が根の直下を指してしまう。
// 区切りだけ戻して、階層の関係を残す。
//
// 版は問い合わせに付ける。受け口は道筋しか見ないので中身に響かず、外で
// 書き換わったときに WebView の控えを跨げる。
export const assetSrc = (abs: string, version = 0): string =>
  `${convertFileSrc(abs).replace(/%2F/gi, "/")}?v=${version}`;
