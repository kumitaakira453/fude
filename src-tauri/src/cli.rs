use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

use crate::review;

// レビューの指摘を CLI から扱う。GUI が起動していなくても動くよう、
// 台帳を直接読み書きする（GUI への IPC を経由しない）。

#[derive(Parser)]
#[command(name = "mdglow", about = "mdglow のレビュー機能を CLI から操作する")]
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
        /// 既定は未解決のみ。未解決には対象が書き換わったものも含む
        #[arg(long, value_enum, default_value_t = StatusFilter::Open)]
        status: StatusFilter,
        #[arg(long, value_enum, default_value_t = OutputFormat::Md)]
        format: OutputFormat,
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
    /// 未解決のみ
    Open,
    /// 解決済みも含む
    All,
}

#[derive(Clone, Copy, ValueEnum)]
enum OutputFormat {
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
            format,
        } => {
            let views = review::list(&review::Filter {
                project,
                file,
                include_resolved: matches!(status, StatusFilter::All),
            })?;
            let out = match format {
                OutputFormat::Md => review::format::threads_markdown(&views),
                OutputFormat::Json => {
                    serde_json::to_string_pretty(&views).map_err(|e| e.to_string())?
                }
            };
            println!("{out}");
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
