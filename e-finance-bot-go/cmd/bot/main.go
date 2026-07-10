// Command bot é o binário de produção do e-finance-bot-go.
// M1: wiring config → slog → mux → ListenAndServe com shutdown gracioso.
// (pgxpool, pipeline, channels e schedulers entram nos milestones seguintes.)
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Gsfrota/efinance-bot-go/internal/config"
	"github.com/Gsfrota/efinance-bot-go/internal/httpapi"
)

func main() {
	cfg := config.Load()
	log := newLogger(cfg)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           httpapi.NewMux(cfg, log),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Info("bot up", "port", cfg.Port, "env", cfg.Env, "version", httpapi.Version, "llm_response", cfg.LLMResponseEnabled)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("listen", "err", err)
			os.Exit(1)
		}
	}()

	// Shutdown gracioso: Railway manda SIGTERM no redeploy.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("shutdown", "err", err)
	}
	log.Info("bot down")
}

func newLogger(cfg config.Config) *slog.Logger {
	level := slog.LevelInfo
	switch cfg.LogLevel {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	// JSONHandler: Cloud Logging / Railway parseiam severity.
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
}
