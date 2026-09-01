/**
 * Go + Gin (gogin.standard) scaffold generator.
 *
 * Runs entirely at npm level — no Python core engine required.
 * Produces a production-ready Go/Gin REST starter with:
 *   - Structured logging (slog / JSON handler)
 *   - /health endpoint
 *   - 12-factor config via env vars
 *   - Dockerfile (multi-stage)
 *   - docker-compose.yml
 *   - GitHub Actions CI
 *   - Makefile
 *   - .workspai/project.json marker
 */

import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';
import { getVersion } from '../update-checker.js';
import { buildCleanGitEnv, isInsideExistingGitWorktree } from '../utils/git-worktree.js';
import {
  buildGoLauncherCmdTemplate,
  buildGoLauncherShellTemplate,
  buildGoMakefileTemplate,
  DEFAULT_GO_VERSION,
  toPascalCase,
  writeGeneratorFile,
} from './go-kit-common.js';
import { buildNativeKitDependabotYml, NATIVE_KIT_BASELINES } from './native-kit-baselines.js';

export interface GoGinVariables {
  project_name: string;
  module_path?: string;
  author?: string;
  description?: string;
  go_version?: string;
  app_version?: string;
  port?: string;
  skipGit?: boolean;
  skipInstall?: boolean;
}

// ─── file templates ───────────────────────────────────────────────────────────

// ─── cmd/server/main.go ───────────────────────────────────────────────────────

function mainGo(v: Required<GoGinVariables>): string {
  return `package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "${v.module_path}/docs"
	"${v.module_path}/internal/config"
	"${v.module_path}/internal/server"
)

// Build-time variables — injected via -ldflags.
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	cfg := config.Load()

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: config.ParseLogLevel(cfg.LogLevel),
	}))
	slog.SetDefault(log)

	r := server.NewRouter(cfg)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	go func() {
		slog.Info("starting", "port", cfg.Port, "version", version, "commit", commit, "date", date, "env", cfg.Env)
		fmt.Printf("\\n🚀  Server  → http://127.0.0.1:%s\\n", cfg.Port)
		fmt.Printf("📖  Docs    → http://127.0.0.1:%s/docs\\n\\n", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down…")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("forced shutdown", "err", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}
`;
}

function goMod(v: Required<GoGinVariables>): string {
  return `module ${v.module_path}

go ${v.go_version}

require (
	github.com/gin-gonic/gin ${NATIVE_KIT_BASELINES.go.gin}
	github.com/swaggo/files ${NATIVE_KIT_BASELINES.go.swagFiles}
	github.com/swaggo/gin-swagger ${NATIVE_KIT_BASELINES.go.ginSwagger}
	github.com/swaggo/swag ${NATIVE_KIT_BASELINES.go.swag}
)
`;
}

function configGo(v: Required<GoGinVariables>): string {
  return `package config

import (
	"log/slog"
	"os"
	"strings"
)

// Config holds application configuration loaded from environment variables.
type Config struct {
	Port     string
	Env      string
	GinMode  string
	LogLevel string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	env := getEnv("APP_ENV", "development")
	return &Config{
		Port:     getEnv("PORT", "${v.port}"),
		Env:      env,
		GinMode:  getEnv("GIN_MODE", "debug"),
		LogLevel: getEnv("LOG_LEVEL", defaultLogLevel(env)),
	}
}

// ParseLogLevel maps a level string to the corresponding slog.Level.
// Falls back to Info for unrecognised values.
func ParseLogLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func defaultLogLevel(env string) string {
	if env == "development" {
		return "debug"
	}
	return "info"
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
`;
}

// ─── internal/server/server.go ───────────────────────────────────────────────

function serverGo(v: Required<GoGinVariables>): string {
  return `package server

import (
	"net/http"

	"github.com/gin-gonic/gin"
	ginSwagger "github.com/swaggo/gin-swagger"
	swaggerFiles "github.com/swaggo/files"

	"${v.module_path}/internal/apierr"
	"${v.module_path}/internal/config"
	"${v.module_path}/internal/handlers"
	"${v.module_path}/internal/middleware"
)

// NewRouter assembles the Gin engine with all middleware and routes.
// Call this from main — or from tests via server.NewRouter(cfg).
func NewRouter(cfg *config.Config) *gin.Engine {
	if cfg.GinMode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.CORS())
	r.Use(middleware.RequestID())
	r.Use(middleware.RateLimit())
	r.Use(middleware.Logger())

	// Swagger UI — /docs redirects to /docs/index.html
	r.GET("/docs", func(c *gin.Context) { c.Redirect(http.StatusFound, "/docs/index.html") })
	r.GET("/docs/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	v1 := r.Group("/api/v1")
	{
		v1.GET("/health/live",  handlers.Liveness)
		v1.GET("/health/ready", handlers.Readiness)
		v1.GET("/echo/:name",   handlers.EchoParams)
	}

	// Return JSON for unknown routes/methods instead of Gin's default text responses.
	// HandleMethodNotAllowed must be true so NoMethod handler fires for 405 cases.
	r.HandleMethodNotAllowed = true
	r.NoRoute(func(c *gin.Context) {
		apierr.NotFound(c, "route not found")
	})
	r.NoMethod(func(c *gin.Context) {
		apierr.MethodNotAllowed(c)
	})

	return r
}
`;
}

// ─── internal/handlers/health.go ─────────────────────────────────────────────

function handlerHealthGo(): string {
  return `package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Liveness signals the process is alive (Kubernetes livenessProbe).
//
//	@Summary		Liveness probe
//	@Description	Returns 200 when the process is alive.
//	@Tags			health
//	@Produce		json
//	@Success		200	{object}	map[string]string
//	@Router			/api/v1/health/live [get]
func Liveness(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"time":   time.Now().UTC().Format(time.RFC3339),
	})
}

// Readiness signals the service can accept traffic (Kubernetes readinessProbe).
// Extend this function to check database connectivity, caches, etc.
//
//	@Summary		Readiness probe
//	@Description	Returns 200 when the service is ready to accept traffic.
//	@Tags			health
//	@Produce		json
//	@Success		200	{object}	map[string]string
//	@Router			/api/v1/health/ready [get]
func Readiness(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ready",
		"time":   time.Now().UTC().Format(time.RFC3339),
	})
}
`;
}

// ─── internal/handlers/health_test.go ────────────────────────────────────────

function handlerHealthTestGo(v: Required<GoGinVariables>): string {
  return `package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"${v.module_path}/internal/config"
	"${v.module_path}/internal/server"
)

func init() { gin.SetMode(gin.TestMode) }

func newRouter() *gin.Engine { return server.NewRouter(config.Load()) }

func TestLiveness(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/health/live", nil)
	newRouter().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("expected ok, got %v", body["status"])
	}
}

func TestReadiness(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/health/ready", nil)
	newRouter().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}
`;
}

function dockerfile(): string {
  return `# ── Build stage ──────────────────────────────────────────────────────
FROM golang:${NATIVE_KIT_BASELINES.go.version}-alpine AS builder

# Build-time version injection
ARG VERSION=dev
ARG COMMIT=none
ARG DATE=unknown

WORKDIR /app
COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \\
    -ldflags="-s -w -X main.version=$\${VERSION} -X main.commit=$\${COMMIT} -X main.date=$\${DATE}" \\
    -o server ./cmd/server

# ── Runtime stage ───────────────────────────────────────────────────────
# alpine includes busybox wget required for the HEALTHCHECK below.
FROM alpine:${NATIVE_KIT_BASELINES.go.alpine}

RUN addgroup -S app && adduser -S -G app app
COPY --from=builder /app/server /server
USER app

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget -qO- http://localhost:8080/api/v1/health/live || exit 1
ENTRYPOINT ["/server"]
`;
}

function dockerCompose(v: Required<GoGinVariables>): string {
  return `version: "3.9"

services:
  api:
    build: .
    container_name: ${v.project_name}
    ports:
      - "${v.port}:${v.port}"
    environment:
      PORT: "${v.port}"
      APP_ENV: development
      GIN_MODE: debug
      LOG_LEVEL: info
      CORS_ALLOW_ORIGINS: "*"
      RATE_LIMIT_RPS: "100"
    restart: unless-stopped
`;
}

function makefile(v: Required<GoGinVariables>): string {
  return buildGoMakefileTemplate({
    projectName: v.project_name,
    devCommand: 'GIN_MODE=debug $(GOBIN)/air',
    runCommand: 'GIN_MODE=debug go run $(LDFLAGS) ./cmd/server',
    testCommand: 'GIN_MODE=test go test ./... -v -race',
    includeLintAndFmt: true,
  });
}

function envExample(v: Required<GoGinVariables>): string {
  return `# Application
PORT=${v.port}
APP_ENV=development
GIN_MODE=debug
LOG_LEVEL=debug

# CORS — comma-separated list of allowed origins, or * to allow all
CORS_ALLOW_ORIGINS=*

# Rate limiting — max requests per IP per second
RATE_LIMIT_RPS=100
`;
}

function gitignore(): string {
  return `# Binaries
bin/
*.exe
*.exe~
*.dll
*.so
*.dylib

# Test binary
*.test

# Output of go coverage tool
*.out
coverage.html

# Go workspace
go.work
go.work.sum

# Environment
.env
.env.local

# Hot reload (air)
tmp/

# Swagger — generated files (committed stub docs/doc.go; run \`make docs\` to regenerate)
docs/swagger.json
docs/swagger.yaml
docs/docs.go

# Editor
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
`;
}

function githubWorkflow(v: Required<GoGinVariables>): string {
  return `name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@${NATIVE_KIT_BASELINES.actions.checkout}

      - name: Set up Go
        uses: actions/setup-go@${NATIVE_KIT_BASELINES.actions.setupGo}
        with:
          go-version: "${v.go_version}"
          cache: true

      - name: Tidy
        run: go mod tidy

      - name: Build
        run: go build ./...

      - name: Test
        run: GIN_MODE=test go test ./... -race -coverprofile=coverage.out

      - name: Upload coverage
        uses: actions/upload-artifact@${NATIVE_KIT_BASELINES.actions.uploadArtifact}
        with:
          name: coverage
          path: coverage.out

  lint:
    name: Lint
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@${NATIVE_KIT_BASELINES.actions.checkout}

      - name: Set up Go
        uses: actions/setup-go@${NATIVE_KIT_BASELINES.actions.setupGo}
        with:
          go-version: "${v.go_version}"
          cache: true

      - name: golangci-lint
        uses: golangci/golangci-lint-action@${NATIVE_KIT_BASELINES.actions.golangciLint}
        with:
          version: ${NATIVE_KIT_BASELINES.go.golangciLint}
`;
}

function readmeMd(v: Required<GoGinVariables>): string {
  return `# ${toPascalCase(v.project_name)}

> ${v.description}

Built with [Go](https://go.dev/) + [Gin](https://gin-gonic.com/) · Scaffolded by [Workspai](https://workspai.dev)

## Quick start

\`\`\`bash
# Run locally (hot reload)
make dev

# Run tests
make test

# Build binary
make build

# Generate / refresh Swagger docs
make docs

# Docker
make docker-up
\`\`\`

## Swagger / OpenAPI

After running \`make docs\`, the interactive UI is available at:

\`\`\`
http://localhost:${v.port}/docs
\`\`\`

The raw OpenAPI spec is served at \`/docs/doc.json\`.

## Endpoints

| Method | Path | Description |
|--------|------|--------------|
| GET    | /api/v1/health/live    | Kubernetes livenessProbe  |
| GET    | /api/v1/health/ready   | Kubernetes readinessProbe |
| GET    | /api/v1/echo/:name     | Example handler \u2014 remove in production |
| GET    | /docs/*                | Swagger UI (OpenAPI docs) |

## Configuration

All configuration is done through environment variables (see \`.env.example\`):

| Variable | Default | Description |
|----------|---------|-------------|
| \`PORT\` | \`${v.port}\` | HTTP listen port |
| \`APP_ENV\` | \`development\` | Application environment |
| \`GIN_MODE\` | \`debug\` | \`debug\` \\| \`release\` \\| \`test\` |
| \`LOG_LEVEL\` | \`debug\` / \`info\` | \`debug\` \\| \`info\` \\| \`warn\` \\| \`error\` |
| \`CORS_ALLOW_ORIGINS\` | \`*\` | Comma-separated list of allowed origins, or \`*\` |
| \`RATE_LIMIT_RPS\` | \`100\` | Max requests per IP per second |

## Project structure

\`\`\`
${v.project_name}/
\u251c\u2500\u2500 cmd/
\u2502   \u2514\u2500\u2500 server/
\u2502       \u2514\u2500\u2500 main.go                  # Graceful shutdown + version ldflags
\u251c\u2500\u2500 docs/                            # Swagger generated files (\`make docs\`)
\u2502   \u2514\u2500\u2500 doc.go                   # Package-level OpenAPI annotations
\u251c\u2500\u2500 internal/
\u2502   \u251c\u2500\u2500 apierr/                      # Consistent JSON error envelope
\u2502   \u2502   \u251c\u2500\u2500 apierr.go
\u2502   \u2502   \u2514\u2500\u2500 apierr_test.go
\u2502   \u251c\u2500\u2500 config/                      # 12-factor configuration
\u2502   \u2502   \u251c\u2500\u2500 config.go
\u2502   \u2502   \u2514\u2500\u2500 config_test.go
\u2502   \u251c\u2500\u2500 handlers/                    # HTTP handlers + tests
\u2502   \u2502   \u251c\u2500\u2500 health.go
\u2502   \u2502   \u251c\u2500\u2500 health_test.go
\u2502   \u2502   \u251c\u2500\u2500 example.go               # EchoParams \u2014 replace with your own handlers
\u2502   \u2502   \u2514\u2500\u2500 example_test.go
\u2502   \u251c\u2500\u2500 middleware/
\u2502   \u2502   \u251c\u2500\u2500 requestid.go             # X-Request-ID + structured logger
\u2502   \u2502   \u251c\u2500\u2500 requestid_test.go
\u2502   \u2502   \u251c\u2500\u2500 cors.go                  # CORS (CORS_ALLOW_ORIGINS)
\u2502   \u2502   \u251c\u2500\u2500 cors_test.go
\u2502   \u2502   \u251c\u2500\u2500 ratelimit.go             # Per-IP limiter (RATE_LIMIT_RPS)
\u2502   \u2502   \u2514\u2500\u2500 ratelimit_test.go
\u2502   \u2514\u2500\u2500 server/
\u2502       \u251c\u2500\u2500 server.go
\u2502       \u2514\u2500\u2500 server_test.go
\u251c\u2500\u2500 .air.toml                        # Hot reload
\u251c\u2500\u2500 .github/workflows/ci.yml         # CI: test + lint
\u251c\u2500\u2500 .golangci.yml
\u251c\u2500\u2500 Dockerfile                       # Multi-stage, alpine HEALTHCHECK
\u251c\u2500\u2500 docker-compose.yml
\u251c\u2500\u2500 Makefile
\u2514\u2500\u2500 README.md
\`\`\`

## Available commands

| Command | Description |
|---------|-------------|
| \`make dev\` | Hot reload via [air](https://github.com/air-verse/air) |
| \`make run\` | Run without hot reload |
| \`make build\` | Binary with version ldflags |
| \`make test\` | Run tests with race detector |
| \`make cover\` | HTML coverage report |
| \`make docs\` | Re-generate Swagger JSON (needs \`swag\`) |
| \`make lint\` | golangci-lint |
| \`make fmt\` | gofmt |
| \`make tidy\` | go mod tidy |
| \`make docker-up\` | Build & run via Docker Compose |
| \`make docker-down\` | Stop |

## License

${v.app_version} \u00b7 ${v.author}
`;
}

// ─── internal/middleware/requestid.go ────────────────────────────────────────

function middlewareGo(): string {
  return `package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

const headerRequestID = "X-Request-ID"

// RequestID injects a unique identifier into every request.
// If the caller sends an X-Request-ID header it is reused; otherwise a new one
// is generated and written back in the response.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader(headerRequestID)
		if id == "" {
			id = newID()
		}
		c.Set(headerRequestID, id)
		c.Header(headerRequestID, id)
		c.Next()
	}
}

// Logger emits a structured JSON log line after each request.
func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		slog.Info("http",
			"method",     c.Request.Method,
			"path",       c.Request.URL.Path,
			"status",     c.Writer.Status(),
			"bytes",      c.Writer.Size(),
			"latency_ms", time.Since(start).Milliseconds(),
			"ip",         c.ClientIP(),
			"request_id", c.GetString(headerRequestID),
		)
	}
}

func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(b)
}
`;
}

// ─── internal/middleware/requestid_test.go ───────────────────────────────────

function middlewareTestGo(v: Required<GoGinVariables>): string {
  return `package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"${v.module_path}/internal/middleware"
)

func init() { gin.SetMode(gin.TestMode) }

func newTestRouter() *gin.Engine {
	r := gin.New()
	r.Use(middleware.RequestID())
	r.Use(middleware.Logger())
	r.GET("/ping", func(c *gin.Context) {
		c.String(http.StatusOK, "pong")
	})
	return r
}

func TestRequestID_IsGenerated(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/ping", nil)
	newTestRouter().ServeHTTP(w, req)

	id := w.Header().Get("X-Request-ID")
	if id == "" {
		t.Fatal("expected X-Request-ID header to be set")
	}
	if len(id) != 16 { // 8 random bytes \u2192 16 hex chars
		t.Fatalf("unexpected request ID length %d, want 16", len(id))
	}
}

func TestRequestID_IsReused(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("X-Request-ID", "my-trace-id")
	newTestRouter().ServeHTTP(w, req)

	id := w.Header().Get("X-Request-ID")
	if id != "my-trace-id" {
		t.Fatalf("expected X-Request-ID to be reused, got %q", id)
	}
}
`;
}

// ─── internal/apierr/apierr.go ───────────────────────────────────────────────

function apierrGo(): string {
  return `// Package apierr provides a consistent JSON error envelope for all API responses.
//
// Every error response looks like:
//
//	{"error": "user not found", "code": "NOT_FOUND", "request_id": "a1b2c3d4..."}
package apierr

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Response is the standard error envelope returned by all API endpoints.
type Response struct {
	Error     string \`json:"error"\`
	Code      string \`json:"code"\`
	RequestID string \`json:"request_id,omitempty"\`
}

func reply(c *gin.Context, status int, msg, code string) {
	c.AbortWithStatusJSON(status, Response{
		Error:     msg,
		Code:      code,
		RequestID: c.GetString("X-Request-ID"),
	})
}

// BadRequest responds with 400 and code "BAD_REQUEST".
func BadRequest(c *gin.Context, msg string) {
	reply(c, http.StatusBadRequest, msg, "BAD_REQUEST")
}

// NotFound responds with 404 and code "NOT_FOUND".
func NotFound(c *gin.Context, msg string) {
	reply(c, http.StatusNotFound, msg, "NOT_FOUND")
}

// Unauthorized responds with 401 and code "UNAUTHORIZED".
func Unauthorized(c *gin.Context) {
	reply(c, http.StatusUnauthorized, "authentication required", "UNAUTHORIZED")
}

// Forbidden responds with 403 and code "FORBIDDEN".
func Forbidden(c *gin.Context) {
	reply(c, http.StatusForbidden, "access denied", "FORBIDDEN")
}

// MethodNotAllowed responds with 405 and code "METHOD_NOT_ALLOWED".
func MethodNotAllowed(c *gin.Context) {
	reply(c, http.StatusMethodNotAllowed, "method not allowed", "METHOD_NOT_ALLOWED")
}

// InternalError responds with 500 and code "INTERNAL_ERROR".
// The original error is intentionally not exposed to the client.
func InternalError(c *gin.Context, _ error) {
	reply(c, http.StatusInternalServerError, "an internal error occurred", "INTERNAL_ERROR")
}

// TooManyRequests responds with 429 and code "TOO_MANY_REQUESTS".
func TooManyRequests(c *gin.Context) {
	reply(c, http.StatusTooManyRequests, "rate limit exceeded", "TOO_MANY_REQUESTS")
}
`;
}

// ─── internal/apierr/apierr_test.go ──────────────────────────────────────────

function apierrTestGo(v: Required<GoGinVariables>): string {
  return `package apierr_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"${v.module_path}/internal/apierr"
)

func init() { gin.SetMode(gin.TestMode) }

func makeRouter(fn gin.HandlerFunc) *gin.Engine {
	r := gin.New()
	r.GET("/test", fn)
	return r
}

func readJSON(t *testing.T, w *httptest.ResponseRecorder) apierr.Response {
	t.Helper()
	var out apierr.Response
	if err := json.NewDecoder(w.Body).Decode(&out); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	return out
}

func TestBadRequest(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	makeRouter(func(c *gin.Context) { apierr.BadRequest(c, "invalid email") }).ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	body := readJSON(t, w)
	if body.Code != "BAD_REQUEST" {
		t.Fatalf("expected BAD_REQUEST, got %q", body.Code)
	}
	if body.Error != "invalid email" {
		t.Fatalf("unexpected error message: %q", body.Error)
	}
}

func TestNotFound(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	makeRouter(func(c *gin.Context) { apierr.NotFound(c, "user not found") }).ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
	body := readJSON(t, w)
	if body.Code != "NOT_FOUND" {
		t.Fatalf("expected NOT_FOUND, got %q", body.Code)
	}
}

func TestUnauthorized(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	makeRouter(func(c *gin.Context) { apierr.Unauthorized(c) }).ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestForbidden(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	makeRouter(func(c *gin.Context) { apierr.Forbidden(c) }).ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
	body := readJSON(t, w)
	if body.Code != "FORBIDDEN" {
		t.Fatalf("expected FORBIDDEN, got %q", body.Code)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	makeRouter(func(c *gin.Context) { apierr.MethodNotAllowed(c) }).ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
	body := readJSON(t, w)
	if body.Code != "METHOD_NOT_ALLOWED" {
		t.Fatalf("expected METHOD_NOT_ALLOWED, got %q", body.Code)
	}
}

func TestInternalError(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	makeRouter(func(c *gin.Context) { apierr.InternalError(c, nil) }).ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
	body := readJSON(t, w)
	if body.Code != "INTERNAL_ERROR" {
		t.Fatalf("expected INTERNAL_ERROR, got %q", body.Code)
	}
}

func TestTooManyRequests(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	makeRouter(func(c *gin.Context) { apierr.TooManyRequests(c) }).ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", w.Code)
	}
	body := readJSON(t, w)
	if body.Code != "TOO_MANY_REQUESTS" {
		t.Fatalf("expected TOO_MANY_REQUESTS, got %q", body.Code)
	}
}
`;
}

// ─── docs/doc.go ──────────────────────────────────────────────────────────────

function swaggerDocGo(v: Required<GoGinVariables>): string {
  return `// Package docs provides the swaggo-generated OpenAPI specification.
//
// Run \`make docs\` to regenerate after changing handler annotations.
//
//\t@title\t\t\t${toPascalCase(v.project_name)} API
//\t@version\t\t${v.app_version}
//\t@description\t${v.description}
//\t@host\t\t\tlocalhost:${v.port}
//\t@BasePath\t\t/
//\t@schemes\t\thttp https
//
//\t@contact.name\t${v.author}
//\t@license.name\tMIT
package docs
`;
}

// ─── internal/handlers/example.go ────────────────────────────────────────────

function exampleHandlerGo(v: Required<GoGinVariables>): string {
  return `package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"${v.module_path}/internal/apierr"
)

// EchoResponse is the JSON body returned by EchoParams.
type EchoResponse struct {
	Name      string \`json:"name"\`
	RequestID string \`json:"request_id"\`
}

// EchoParams is an example handler demonstrating how to:
//   - read URL path parameters
//   - use apierr for consistent JSON error responses
//   - access the request ID injected by RequestID middleware
//
// Replace or remove this file once you add your own business logic.
//
//	@Summary		Echo path parameter
//	@Description	Returns the :name path parameter together with the request ID.
//	@Tags			example
//	@Produce		json
//	@Param			name	path		string	true	"Name to echo"
//	@Success		200		{object}	handlers.EchoResponse
//	@Failure		400		{object}	apierr.Response
//	@Router			/api/v1/echo/{name} [get]
func EchoParams(c *gin.Context) {
	name := c.Param("name")
	if name == "" {
		apierr.BadRequest(c, "name parameter is required")
		return
	}
	c.JSON(http.StatusOK, EchoResponse{
		Name:      name,
		RequestID: c.GetString("X-Request-ID"),
	})
}
`;
}

// ─── internal/handlers/example_test.go ───────────────────────────────────────

function exampleHandlerTestGo(v: Required<GoGinVariables>): string {
  return `package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"${v.module_path}/internal/handlers"
	"${v.module_path}/internal/middleware"
)

func newEchoRouter() *gin.Engine {
	r := gin.New()
	r.Use(middleware.RequestID())
	r.GET("/echo/:name", handlers.EchoParams)
	return r
}

func TestEchoParams_Success(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/echo/alice", nil)
	newEchoRouter().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["name"] != "alice" {
		t.Fatalf("expected name=alice, got %v", body["name"])
	}
	if body["request_id"] == nil || body["request_id"] == "" {
		t.Fatal("expected request_id to be set by RequestID middleware")
	}
}

// TestEchoParams_EmptyName registers EchoParams on a param-free route so that
// c.Param("name") returns "" and the 400 guard executes.
func TestEchoParams_EmptyName(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	r.GET("/echo-bare", handlers.EchoParams)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/echo-bare", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["code"] != "BAD_REQUEST" {
		t.Fatalf("expected code=BAD_REQUEST, got %v", body["code"])
	}
}
`;
}

// ─── internal/config/config_test.go ──────────────────────────────────────────

function configTestGo(v: Required<GoGinVariables>): string {
  return `package config_test

import (
	"log/slog"
	"testing"

	"${v.module_path}/internal/config"
)

func TestParseLogLevel(t *testing.T) {
	tests := []struct {
		input string
		want  slog.Level
	}{
		{"debug", slog.LevelDebug},
		{"DEBUG", slog.LevelDebug},
		{"warn", slog.LevelWarn},
		{"warning", slog.LevelWarn},
		{"error", slog.LevelError},
		{"info", slog.LevelInfo},
		{"", slog.LevelInfo},
		{"unknown", slog.LevelInfo},
	}
	for _, tc := range tests {
		got := config.ParseLogLevel(tc.input)
		if got != tc.want {
			t.Errorf("ParseLogLevel(%q) = %v, want %v", tc.input, got, tc.want)
		}
	}
}

func TestLoad_EnvOverride(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("APP_ENV", "production")
	t.Setenv("LOG_LEVEL", "warn")
	t.Setenv("GIN_MODE", "release")

	cfg := config.Load()

	if cfg.Port != "9090" {
		t.Errorf("expected Port=9090, got %q", cfg.Port)
	}
	if cfg.Env != "production" {
		t.Errorf("expected Env=production, got %q", cfg.Env)
	}
	if cfg.LogLevel != "warn" {
		t.Errorf("expected LogLevel=warn, got %q", cfg.LogLevel)
	}
	if cfg.GinMode != "release" {
		t.Errorf("expected GinMode=release, got %q", cfg.GinMode)
	}
}

func TestLoad_Defaults(t *testing.T) {
	// Empty string forces getEnv() to return the built-in fallback value.
	t.Setenv("PORT", "")
	t.Setenv("APP_ENV", "")
	t.Setenv("LOG_LEVEL", "")
	t.Setenv("GIN_MODE", "")

	cfg := config.Load()

	if cfg.Port != "${v.port}" {
		t.Errorf("expected default Port=${v.port}, got %q", cfg.Port)
	}
	if cfg.Env != "development" {
		t.Errorf("expected default Env=development, got %q", cfg.Env)
	}
	// APP_ENV="" → fallback "development" → defaultLogLevel → "debug"
	if cfg.LogLevel != "debug" {
		t.Errorf("expected default LogLevel=debug (development env), got %q", cfg.LogLevel)
	}
	if cfg.GinMode != "debug" {
		t.Errorf("expected default GinMode=debug, got %q", cfg.GinMode)
	}
}
`;
}

// ─── internal/middleware/cors.go ────────────────────────────────────────────────

function corsMiddlewareGo(): string {
  return `package middleware

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORS returns a Gin middleware configured via CORS_ALLOW_ORIGINS env var.
//
// Set CORS_ALLOW_ORIGINS="*" for development (the default when unset).
// In production supply a comma-separated list of allowed origins:
//
//	CORS_ALLOW_ORIGINS=https://app.example.com,https://admin.example.com
func CORS() gin.HandlerFunc {
	allowed := os.Getenv("CORS_ALLOW_ORIGINS")
	if allowed == "" {
		allowed = "*"
	}
	allowAll := allowed == "*"

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if allowAll {
			c.Header("Access-Control-Allow-Origin", "*")
		} else if origin != "" {
			for _, o := range strings.Split(allowed, ",") {
				if strings.TrimSpace(o) == origin {
					c.Header("Access-Control-Allow-Origin", origin)
					c.Header("Vary", "Origin")
					break
				}
			}
		}
		c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin,Content-Type,Authorization,X-Request-ID")
		c.Header("Access-Control-Expose-Headers", "X-Request-ID")
		c.Header("Access-Control-Max-Age", "600")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
`;
}

// ─── internal/middleware/cors_test.go ────────────────────────────────────────────

function corsMiddlewareTestGo(v: Required<GoGinVariables>): string {
  return `package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"${v.module_path}/internal/middleware"
)

func newCORSRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.CORS())
	r.GET("/ping", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

func TestCORS_Wildcard(t *testing.T) {
	t.Setenv("CORS_ALLOW_ORIGINS", "*")
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("Origin", "https://example.com")
	newCORSRouter(t).ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected ACAO=*, got %q", got)
	}
}

func TestCORS_Preflight(t *testing.T) {
	t.Setenv("CORS_ALLOW_ORIGINS", "*")
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.CORS())

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodOptions, "/ping", nil)
	req.Header.Set("Origin", "https://example.com")
	req.Header.Set("Access-Control-Request-Method", "POST")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 preflight, got %d", w.Code)
	}
}

func TestCORS_SpecificOrigin_Allowed(t *testing.T) {
	t.Setenv("CORS_ALLOW_ORIGINS", "https://app.example.com")
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("Origin", "https://app.example.com")
	newCORSRouter(t).ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Fatalf("expected ACAO=https://app.example.com, got %q", got)
	}
}

func TestCORS_SpecificOrigin_Denied(t *testing.T) {
	t.Setenv("CORS_ALLOW_ORIGINS", "https://app.example.com")
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("Origin", "https://evil.com")
	newCORSRouter(t).ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no ACAO header for denied origin, got %q", got)
	}
}

func TestCORS_Default_Origin(t *testing.T) {
	// When CORS_ALLOW_ORIGINS is unset the middleware must default to "*".
	t.Setenv("CORS_ALLOW_ORIGINS", "")
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("Origin", "https://anywhere.com")
	newCORSRouter(t).ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got == "" {
		t.Fatal("expected CORS header when CORS_ALLOW_ORIGINS defaults to *")
	}
}
`;
}

// ─── internal/server/server_test.go ────────────────────────────────────────────

function serverTestGo(v: Required<GoGinVariables>): string {
  return `package server_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"${v.module_path}/internal/config"
	"${v.module_path}/internal/server"
)

func init() { gin.SetMode(gin.TestMode) }

type serverAPIError struct {
	Code    string \`json:"code"\`
	Message string \`json:"message"\`
}

func TestServer_NotFound_JSON(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/no-such-route", nil)
	server.NewRouter(config.Load()).ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
	var body serverAPIError
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("expected JSON error body: %v", err)
	}
	if body.Code != "NOT_FOUND" {
		t.Fatalf("expected code=NOT_FOUND, got %q", body.Code)
	}
}

func TestServer_MethodNotAllowed_JSON(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/health/live", nil)
	server.NewRouter(config.Load()).ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
	var body serverAPIError
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("expected JSON error body: %v", err)
	}
	if body.Code != "METHOD_NOT_ALLOWED" {
		t.Fatalf("expected code=METHOD_NOT_ALLOWED, got %q", body.Code)
	}
}

func TestServer_CORS_Header(t *testing.T) {
	t.Setenv("CORS_ALLOW_ORIGINS", "*")
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/health/live", nil)
	req.Header.Set("Origin", "https://example.com")
	server.NewRouter(config.Load()).ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got == "" {
		t.Fatal("expected Access-Control-Allow-Origin header to be set")
	}
}

func TestServer_HealthLive(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/health/live", nil)
	server.NewRouter(config.Load()).ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}
}

func TestServer_Docs_Redirect(t *testing.T) {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/docs", nil)
	server.NewRouter(config.Load()).ServeHTTP(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("expected 302 redirect from /docs, got %d", w.Code)
	}
	if loc := w.Header().Get("Location"); loc != "/docs/index.html" {
		t.Fatalf("expected Location=/docs/index.html, got %q", loc)
	}
}

func TestServer_ReleaseMode(t *testing.T) {
	// Covers the gin.SetMode(gin.ReleaseMode) branch in NewRouter.
	// Restore test mode after so other tests are not affected.
	t.Cleanup(func() { gin.SetMode(gin.TestMode) })
	t.Setenv("GIN_MODE", "release")
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/health/live", nil)
	server.NewRouter(config.Load()).ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 in release mode, got %d", w.Code)
	}
}
`;
}

// ─── internal/middleware/ratelimit.go ───────────────────────────────────────────

function ratelimitMiddlewareGo(v: Required<GoGinVariables>): string {
  return `package middleware

import (
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"${v.module_path}/internal/apierr"
)

// ipBucket tracks the per-IP fixed-window request counter.
type ipBucket struct {
	mu          sync.Mutex
	count       int
	windowStart time.Time
}

// RateLimit returns a per-IP fixed-window rate limiter.
// Configure the limit via RATE_LIMIT_RPS env var (requests per second, default 100).
func RateLimit() gin.HandlerFunc {
	rps := 100
	if raw := os.Getenv("RATE_LIMIT_RPS"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			rps = n
		}
	}
	var buckets sync.Map
	return func(c *gin.Context) {
		ip := c.ClientIP()
		now := time.Now()
		v, _ := buckets.LoadOrStore(ip, &ipBucket{windowStart: now})
		b := v.(*ipBucket)
		b.mu.Lock()
		if now.Sub(b.windowStart) >= time.Second {
			b.count = 0
			b.windowStart = now
		}
		b.count++
		count := b.count
		b.mu.Unlock()
		if count > rps {
			apierr.TooManyRequests(c)
			c.Header("Retry-After", "1")
			return
		}
		c.Next()
	}
}
`;
}

// ─── internal/middleware/ratelimit_test.go ──────────────────────────────────────

function ratelimitMiddlewareTestGo(v: Required<GoGinVariables>): string {
  return `package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"${v.module_path}/internal/middleware"
)

func newRateLimitRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RateLimit())
	r.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

func TestRateLimit_AllowsUnderLimit(t *testing.T) {
	t.Setenv("RATE_LIMIT_RPS", "3")
	r := newRateLimitRouter(t)

	for i := 0; i < 3; i++ {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/", nil)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, w.Code)
		}
	}
}

func TestRateLimit_Blocks_After_Limit(t *testing.T) {
	t.Setenv("RATE_LIMIT_RPS", "2")
	r := newRateLimitRouter(t)

	// Exhaust the limit.
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/", nil)
		r.ServeHTTP(w, req)
	}

	// Next request must be rejected.
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after limit, got %d", w.Code)
	}
}

func TestRateLimit_InvalidRPS(t *testing.T) {
	// When RATE_LIMIT_RPS is not a valid positive integer, the middleware
	// must fall back to the default limit (100 rps) and allow normal requests.
	t.Setenv("RATE_LIMIT_RPS", "not-a-number")
	r := newRateLimitRouter(t)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with invalid RPS env, got %d", w.Code)
	}
}
`;
}

// ─── .air.toml ────────────────────────────────────────────────────────────────

function airToml(v: Required<GoGinVariables>): string {
  return `# Air — live reload for Go projects
# https://github.com/air-verse/air
root = "."
tmp_dir = "tmp"

[build]
	pre_cmd        = ["$(go env GOPATH)/bin/swag init -g main.go -d cmd/server,internal/handlers,internal/apierr -o docs --parseDependency 2>/dev/null || true"]
  cmd            = "go build -o ./tmp/server ./cmd/server"
  bin            = "./tmp/server"
  include_ext    = ["go", "yaml", "yml", "env"]
  exclude_dir    = ["tmp", "vendor", ".git", "testdata", "docs"]
  delay          = 500
  rerun_delay    = 500
  send_interrupt = true
  kill_delay     = "200ms"

[env]
  GIN_MODE = "debug"
  PORT     = "${v.port}"

[misc]
  clean_on_exit = true

[log]
  time = false
`;
}

function golangciYml(modulePath: string): string {
  return `version: "2"

run:
  timeout: 5m

linters:
  default: standard
  enable:
    - bodyclose
    - durationcheck
    - errcheck
    - errname
    - errorlint
    - govet
    - ineffassign
    - misspell
    - noctx
    - nolintlint
    - prealloc
    - staticcheck
    - unconvert
    - unused
    - wrapcheck
  settings:
    govet:
      enable:
        - shadow
    wrapcheck:
      ignore-package-globs:
        - "${modulePath}/*"
  exclusions:
    rules:
      - path: _test\\.go
        linters:
          - errcheck
          - wrapcheck

formatters:
  enable:
    - gci
    - goimports
  settings:
    gci:
      sections:
        - standard
        - default
        - prefix(${modulePath})
    goimports:
      local-prefixes:
        - "${modulePath}"

issues:
  max-same-issues: 5
`;
}

function contextJson(): string {
  return JSON.stringify({ engine: 'npm', runtime: 'go' }, null, 2);
}

function projectJson(v: Required<GoGinVariables>, rapidkitVersion: string): string {
  return JSON.stringify(
    {
      kit_name: 'gogin.standard',
      runtime: 'go',
      module_support: false,
      project_name: v.project_name,
      module_path: v.module_path,
      app_version: v.app_version,
      created_by: 'workspai',
      workspai_version: rapidkitVersion,
      rapidkit_version: rapidkitVersion,
      created_at: new Date().toISOString(),
    },
    null,
    2
  );
}

function rapidkitScript(v: Required<GoGinVariables>): string {
  return buildGoLauncherShellTemplate({
    runtimeLabel: 'Go/Gin',
    projectName: v.project_name,
    fallbackDevCommand: 'cd "$SCRIPT_DIR" && GIN_MODE=debug exec go run ./cmd/server "$@"',
  });
}

function rapidkitCmd(v: Required<GoGinVariables>): string {
  return buildGoLauncherCmdTemplate({
    runtimeLabel: 'Go/Gin',
    projectName: v.project_name,
  });
}

// ─── main generator ───────────────────────────────────────────────────────────

export async function generateGoGinKit(
  projectPath: string,
  variables: GoGinVariables
): Promise<void> {
  const v: Required<GoGinVariables> = {
    project_name: variables.project_name,
    module_path: variables.module_path || variables.project_name,
    author: variables.author || 'Workspai User',
    description: variables.description || `Go/Gin REST API — ${variables.project_name}`,
    go_version: variables.go_version || DEFAULT_GO_VERSION,
    app_version: variables.app_version || '0.1.0',
    port: variables.port || '8080',
    skipGit: variables.skipGit ?? false,
    skipInstall: variables.skipInstall ?? false,
  };

  const rapidkitVersion = getVersion();

  // Keep --skip-install deterministic and independent from host toolchains.
  if (!v.skipInstall) {
    try {
      await execa('go', ['version'], { timeout: 3000 });
    } catch {
      console.log(
        chalk.yellow(
          `\n⚠  Go not found in PATH — project will be scaffolded, but this baseline requires Go ${DEFAULT_GO_VERSION}+`
        )
      );
      console.log(chalk.gray('   Install: https://go.dev/dl/\n'));
    }
  }

  const spinner = ora(`Generating Go/Gin project: ${v.project_name}…`).start();

  try {
    const w = (rel: string, content: string) =>
      writeGeneratorFile(path.join(projectPath, rel), content);

    const rapidkitScriptPath = path.join(projectPath, 'rapidkit');
    const rapidkitCmdPath = path.join(projectPath, 'rapidkit.cmd');

    await Promise.all([
      w('cmd/server/main.go', mainGo(v)),
      w('go.mod', goMod(v)),
      w('internal/config/config.go', configGo(v)),
      w('internal/server/server.go', serverGo(v)),
      w('internal/middleware/requestid.go', middlewareGo()),
      w('internal/middleware/requestid_test.go', middlewareTestGo(v)),
      w('internal/apierr/apierr.go', apierrGo()),
      w('internal/apierr/apierr_test.go', apierrTestGo(v)),
      w('internal/handlers/health.go', handlerHealthGo()),
      w('internal/handlers/health_test.go', handlerHealthTestGo(v)),
      w('internal/handlers/example.go', exampleHandlerGo(v)),
      w('internal/handlers/example_test.go', exampleHandlerTestGo(v)),
      w('internal/config/config_test.go', configTestGo(v)),
      w('internal/middleware/cors.go', corsMiddlewareGo()),
      w('internal/middleware/cors_test.go', corsMiddlewareTestGo(v)),
      w('internal/middleware/ratelimit.go', ratelimitMiddlewareGo(v)),
      w('internal/middleware/ratelimit_test.go', ratelimitMiddlewareTestGo(v)),
      w('internal/server/server_test.go', serverTestGo(v)),
      w('docs/doc.go', swaggerDocGo(v)),
      w('.air.toml', airToml(v)),
      w('Dockerfile', dockerfile()),
      w('docker-compose.yml', dockerCompose(v)),
      w('Makefile', makefile(v)),
      w('.golangci.yml', golangciYml(v.module_path)),
      w('.env.example', envExample(v)),
      w('.gitignore', gitignore()),
      w('.github/workflows/ci.yml', githubWorkflow(v)),
      w('.github/dependabot.yml', buildNativeKitDependabotYml('gomod')),
      w('README.md', readmeMd(v)),
      w('.workspai/project.json', projectJson(v, rapidkitVersion)),
      w('.workspai/context.json', contextJson()),
      w('rapidkit', rapidkitScript(v)),
      w('rapidkit.cmd', rapidkitCmd(v)),
    ]);

    await fs.chmod(rapidkitScriptPath, 0o755);
    await fs.chmod(rapidkitCmdPath, 0o755);

    spinner.succeed(chalk.green(`Project created at ${projectPath}`));

    if (v.skipInstall) {
      spinner.info(chalk.gray('Skipped Go dependency warm-up (--skip-install).'));
    } else {
      // Fetch Go dependencies automatically
      try {
        spinner.start('Fetching Go dependencies…');
        await execa('go', ['mod', 'tidy'], { cwd: projectPath, timeout: 120_000 });
        spinner.succeed(chalk.gray('✓ go mod tidy completed'));
      } catch {
        spinner.warn(chalk.yellow('⚠  go mod tidy failed — run manually: go mod tidy'));
      }
    }

    // git init
    if (!v.skipGit) {
      try {
        if (await isInsideExistingGitWorktree(projectPath)) {
          console.log(
            chalk.gray('⚠  git init skipped (target is inside an existing git worktree)')
          );
        } else {
          await execa('git', ['init'], { cwd: projectPath, env: buildCleanGitEnv() });
          await execa('git', ['add', '-A'], { cwd: projectPath, env: buildCleanGitEnv() });
          await execa(
            'git',
            ['commit', '-m', 'chore: initial scaffold (rapidkit gogin.standard)'],
            {
              cwd: projectPath,
              env: buildCleanGitEnv(),
            }
          );
          console.log(chalk.gray('✓ git repository initialized'));
        }
      } catch {
        console.log(chalk.gray('⚠  git init skipped (git not found or error)'));
      }
    }

    console.log('');
    console.log(chalk.bold('✅ Go/Gin project ready!'));
    console.log('');
    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.white(`  cd ${v.project_name}`));
    console.log(chalk.white('  make run            # start dev server'));
    console.log(chalk.white('  make test           # run tests'));
    console.log('');
    console.log(chalk.gray('Server will listen on port ' + v.port));
    console.log(chalk.gray('  http://localhost:' + v.port + '/api/v1/health/live'));
    console.log(chalk.gray('  http://localhost:' + v.port + '/api/v1/health/ready'));
    console.log('');
    console.log(
      chalk.yellow(
        'ℹ  RapidKit Core modules are not available for Go projects (module system uses Python/pip).'
      )
    );
    console.log('');
  } catch (err) {
    spinner.fail(chalk.red('Failed to generate Go/Gin project'));
    throw err;
  }
}
