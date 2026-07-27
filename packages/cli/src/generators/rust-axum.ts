/**
 * Deterministic Rust/Axum scaffold owned by the Workspai npm CLI.
 *
 * Axum intentionally does not prescribe an official application generator.
 * This baseline therefore uses Cargo's standard layout while keeping every
 * generated dependency and lifecycle surface explicit and reviewable.
 */

import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { execa } from 'execa';

import { getVersion } from '../update-checker.js';
import { buildCleanGitEnv, isInsideExistingGitWorktree } from '../utils/git-worktree.js';
import { writeGeneratorFile } from './go-kit-common.js';

export const DEFAULT_AXUM_PORT = '3000';

export interface RustAxumVariables {
  project_name: string;
  description?: string;
  port?: string;
  skipGit?: boolean;
  skipInstall?: boolean;
}

function crateName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-') || 'axum-api'
  );
}

function cargoToml(name: string, description: string): string {
  return `[package]
name = "${name}"
version = "0.1.0"
edition = "2021"
description = "${description.replace(/["\r\n]/g, ' ')}"

[dependencies]
axum = "0.8"
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread", "signal"] }
tower-http = { version = "0.6", features = ["trace"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt"] }

[dev-dependencies]
tower = { version = "0.5", features = ["util"] }
`;
}

function mainRs(port: string): string {
  return `use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::{env, net::SocketAddr};
use tower_http::trace::TraceLayer;
use tracing::info;

#[derive(Serialize)]
struct Health {
    status: &'static str,
}

fn app() -> Router {
    Router::new()
        .route("/health", get(|| async { Json(Health { status: "ok" }) }))
        .layer(TraceLayer::new_for_http())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();

    let port = env::var("PORT").unwrap_or_else(|_| "${port}".to_string());
    let address: SocketAddr = format!("0.0.0.0:{port}").parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    info!(%address, "Axum service listening");
    axum::serve(listener, app())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::{Request, StatusCode}};
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_is_ready() {
        let response = app()
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}
`;
}

function dockerfile(name: string): string {
  return `FROM rust:1-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN useradd --create-home --uid 10001 app
COPY --from=builder /app/target/release/${name} /usr/local/bin/${name}
USER app
ENV PORT=3000
EXPOSE 3000
CMD ["/usr/local/bin/${name}"]
`;
}

function githubWorkflow(): string {
  return `name: CI
on:
  push:
  pull_request:
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --check
      - run: cargo clippy --all-targets --all-features -- -D warnings
      - run: cargo test --all-targets --all-features
      - run: cargo build --release
`;
}

function launcherShell(): string {
  return `#!/usr/bin/env sh
set -eu
COMMAND="\${1:-help}"
shift 2>/dev/null || true
case "$COMMAND" in
  init) cargo fetch "$@" ;;
  dev) RUST_LOG="\${RUST_LOG:-info,tower_http=info}" cargo run "$@" ;;
  start) cargo run --release "$@" ;;
  build) cargo build --release "$@" ;;
  test) cargo test --all-targets --all-features "$@" ;;
  lint) cargo clippy --all-targets --all-features -- -D warnings ;;
  format) cargo fmt --all "$@" ;;
  help|--help|-h)
    echo "Workspai Rust/Axum commands: init, dev, start, build, test, lint, format"
    ;;
  *) echo "Unknown command: $COMMAND" >&2; exit 1 ;;
esac
`;
}

function launcherCmd(): string {
  return `@echo off
set COMMAND=%1
if "%COMMAND%"=="init" cargo fetch
if "%COMMAND%"=="dev" cargo run
if "%COMMAND%"=="start" cargo run --release
if "%COMMAND%"=="build" cargo build --release
if "%COMMAND%"=="test" cargo test --all-targets --all-features
if "%COMMAND%"=="lint" cargo clippy --all-targets --all-features -- -D warnings
if "%COMMAND%"=="format" cargo fmt --all
if "%COMMAND%"=="help" echo Workspai Rust/Axum commands: init, dev, start, build, test, lint, format
`;
}

async function maybeInitGit(projectPath: string, skipGit: boolean): Promise<void> {
  if (
    skipGit ||
    (await isInsideExistingGitWorktree(projectPath)) ||
    (await fs
      .stat(path.join(projectPath, '.git'))
      .then(() => true)
      .catch(() => false))
  ) {
    return;
  }
  await execa('git', ['init'], {
    cwd: projectPath,
    reject: false,
    env: buildCleanGitEnv(),
  });
}

export async function generateRustAxumKit(
  projectPath: string,
  variables: RustAxumVariables
): Promise<void> {
  const name = crateName(variables.project_name);
  const port = variables.port && /^\d+$/.test(variables.port) ? variables.port : DEFAULT_AXUM_PORT;
  const description =
    variables.description?.trim() || 'Production-ready Axum API scaffolded by Workspai.';
  const generatedAt = new Date().toISOString();
  const version = getVersion();

  await fs.mkdir(projectPath, { recursive: true });
  await writeGeneratorFile(path.join(projectPath, 'Cargo.toml'), cargoToml(name, description));
  await writeGeneratorFile(path.join(projectPath, 'src', 'main.rs'), mainRs(port));
  await writeGeneratorFile(path.join(projectPath, '.env.example'), `PORT=${port}\nRUST_LOG=info\n`);
  await writeGeneratorFile(path.join(projectPath, '.gitignore'), '/target\n.env\n');
  await writeGeneratorFile(path.join(projectPath, 'Dockerfile'), dockerfile(name));
  await writeGeneratorFile(path.join(projectPath, '.dockerignore'), 'target\n.git\n.env\n');
  await writeGeneratorFile(
    path.join(projectPath, '.github', 'workflows', 'ci.yml'),
    githubWorkflow()
  );
  await writeGeneratorFile(path.join(projectPath, 'rapidkit'), launcherShell());
  await writeGeneratorFile(path.join(projectPath, 'rapidkit.cmd'), launcherCmd());
  await writeGeneratorFile(
    path.join(projectPath, '.workspai', 'context.json'),
    JSON.stringify(
      {
        engine: 'npm',
        runtime: 'rust',
        framework: 'axum',
        kind: 'backend',
        category: 'backend',
      },
      null,
      2
    )
  );
  await writeGeneratorFile(
    path.join(projectPath, '.workspai', 'project.json'),
    JSON.stringify(
      {
        schema_version: '1.0',
        name,
        slug: name,
        kind: 'backend',
        project_type: 'backend',
        category: 'backend',
        runtime: 'rust',
        framework: 'axum',
        framework_display_name: 'Axum',
        kit_name: 'rust.axum',
        kit: 'rust.axum',
        engine: 'npm',
        support_tier: 'extended',
        module_support: false,
        modules: [],
        workspai_version: version,
        rapidkit_version: version,
        generated_by: 'workspai',
        generated_at: generatedAt,
        ports: [{ name: 'http', port: Number(port), protocol: 'http' }],
        contracts: {
          owns: [],
          apis: [{ method: 'GET', path: '/health' }],
          publishes: [],
          consumes: [],
          dependsOn: [],
          env: ['PORT', 'RUST_LOG'],
        },
      },
      null,
      2
    )
  );

  if (process.platform !== 'win32') {
    await fs.chmod(path.join(projectPath, 'rapidkit'), 0o755);
  }
  await maybeInitGit(projectPath, variables.skipGit ?? false);

  console.log(chalk.green('\n✅ Rust/Axum project ready!\n'));
  console.log(chalk.gray(`Next: cd ${variables.project_name} && npx workspai init`));
}
