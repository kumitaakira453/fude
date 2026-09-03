use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

use crate::review;

// レビューの指摘を CLI から扱う。GUI が起動していなくても動くよう、
// 台帳を直接読み書きする（GUI への IPC を経由しない）。

#[derive(Parser)]
#[command(name = "fude", about = "fude のレビュー機能を CLI から操作する")]
pub struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// レビューの指摘を扱う
    Review {
        #[command(subcommand)]
        action: ReviewAction,
    },
}

#[derive(Subcommand)]
enum ReviewAction {
    /// 指摘を一覧する
    List {
        /// このディレクトリ配下のファイルに絞る
        #[arg(long)]
        project: Option<PathBuf>,
        /// このファイルに絞る（絶対パスでも相対パスでもよい）
        #[arg(long)]
        file: Option<PathBuf>,
        /// 既定は未対応のみ（最後の発言が自分でないもの）
        #[arg(long, value_enum, default_value_t = StatusFilter::Unanswered)]
        status: StatusFilter,
        /// 「自分の返信」と見なす author。未対応の判定に使う
        #[arg(long, default_value = review::DEFAULT_AUTHOR)]
        author: String,
        #[arg(long, value_enum, default_value_t = OutputFormat::Agent)]
        format: OutputFormat,
        /// 1 件 1 行の一覧だけ出す
        #[arg(long)]
        brief: bool,
        /// 該当が 0 件のとき終了コード 2 で終わる
        #[arg(long)]
        exit_code: bool,
    },
    /// 指摘に返信する
    Reply {
        #[arg(long)]
        thread: String,
        #[arg(long)]
        body: String,
        #[arg(long, default_value = "AI")]
        author: String,
    },
    /// 指摘を解決済みにする
    Resolve {
        #[arg(long)]
        thread: String,
        #[arg(long, default_value = "AI")]
        by: String,
    },
    /// 解決を取り消して未解決に戻す
    Reopen {
        #[arg(long)]
        thread: String,
    },
    /// 対応が済んだことを宣言し、現在の内容を版として記録する
    Commit {
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        message: String,
    },
    /// ファイルの版を新しい順に一覧する
    Versions {
        #[arg(long)]
        file: PathBuf,
    },
    /// Remarker に溜まっている指摘を取り込む（何度実行しても二重に入らない）
    ImportRemarker,
}

#[derive(Clone, Copy, ValueEnum)]
enum StatusFilter {
    /// 未対応のみ（最後の発言が自分でないもの）
    Unanswered,
    /// 未解決すべて（返信済みも含む）
    Open,
    /// 解決済みも含む
    All,
}

impl From<StatusFilter> for review::StatusFilter {
    fn from(value: StatusFilter) -> Self {
        match value {
            StatusFilter::Unanswered => review::StatusFilter::Unanswered,
            StatusFilter::Open => review::StatusFilter::Open,
            StatusFilter::All => review::StatusFilter::All,
        }
    }
}

#[derive(Clone, Copy, ValueEnum)]
enum OutputFormat {
    /// AI 向け。要約を先に置き、行動が変わらない情報を落とす
    Agent,
    /// 人間向け。版や絶対時刻まで出す
    Md,
    Json,
}

pub fn run() -> Result<(), String> {
    let cli = Cli::parse();
    match cli.command {
        Command::Review { action } => run_review(action),
    }
}

fn run_review(action: ReviewAction) -> Result<(), String> {
    match action {
        ReviewAction::List {
            project,
            file,
            status,
            author,
            format,
            brief,
            exit_code,
        } => {
            // 対象の見出しは絞り込んだものをそのまま出す。何を数えたのかが
            // 分からないと、0 件の意味を読み手が取り違える。
            let target = file
                .as_ref()
                .or(project.as_ref())
                .map(|p| p.display().to_string());
            let filter = review::Filter {
                project,
                file,
                status: status.into(),
                author,
            };
            let views = review::list(&filter)?;

            if matches!(format, OutputFormat::Json) {
                let out = serde_json::to_string_pretty(&views).map_err(|e| e.to_string())?;
                println!("{out}");
            } else {
                let counts = review::counts(&filter)?;
                println!(
                    "{}",
                    review::format::summary_line(&counts, target.as_deref())
                );
                if views.is_empty() {
                    println!(
                        "{}",
                        review::format::empty_notice(
                            filter.status,
                            &counts,
                            target.as_deref()
                        )
                    );
                } else if brief {
                    print!("{}", review::format::threads_brief(&views));
                } else if matches!(format, OutputFormat::Agent) {
                    println!(
                        "返信は fude review reply --thread <ID> --author {} --body \"<何をしたか>\" で行う。\
                         解決済みにするのは人間の操作なので、resolve は実行しない。",
                        filter.author
                    );
                    print!("{}", review::format::threads_agent(&views));
                } else {
                    print!("{}", review::format::threads_markdown(&views));
                }
            }

            if exit_code && views.is_empty() {
                // エラーの 1 と混ざらないよう 2 を使う。
                use std::io::Write;
                let _ = std::io::stdout().flush();
                std::process::exit(2);
            }
        }
        ReviewAction::Reply {
            thread,
            body,
            author,
        } => {
            review::reply(&thread, &author, &body)?;
            println!("返信しました: #{thread}");
        }
        ReviewAction::Resolve { thread, by } => {
            review::resolve(&thread, &by)?;
            println!("解決済みにしました: #{thread}");
        }
        ReviewAction::Reopen { thread } => {
            review::reopen(&thread)?;
            println!("未解決に戻しました: #{thread}");
        }
        ReviewAction::Commit { file, message } => {
            let id = review::commit(&file, &message)?;
            let short: String = id.chars().take(8).collect();
            println!("版を記録しました: {short} \"{message}\"");
        }
        ReviewAction::ImportRemarker => {
            let report = review::import::import_remarker()?;
            println!("{}", review::import::describe(&report)?);
        }
        ReviewAction::Versions { file } => {
            let versions = review::versions(&file)?;
            if versions.is_empty() {
                println!("記録された版はありません。");
            }
            for v in versions {
                let short: String = v.id.chars().take(8).collect();
                let when = review::store::format_iso_utc(v.created_at);
                let label = v.label.unwrap_or_default();
                println!("{short}  {when}  {:?}  {label}", v.origin);
            }
        }
    }
    Ok(())
}
