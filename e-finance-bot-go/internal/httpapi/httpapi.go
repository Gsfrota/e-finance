// Package httpapi monta o mux (Go 1.22+ method routing) e os handlers de borda.
// M1: /health + webhooks retornando 200 (o decode real dos payloads é M2).
package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/Gsfrota/efinance-bot-go/internal/config"
)

// Version é sobrescrito via -ldflags "-X ...httpapi.Version=<sha>" no build.
var Version = "dev"

func NewMux(cfg config.Config, log *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health)
	mux.HandleFunc("POST /webhook/whatsapp/{secret}", waWebhook(cfg, log))
	mux.HandleFunc("POST /webhook/telegram", tgWebhook(cfg, log))
	return logMiddleware(mux, log)
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": Version,
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}

// waWebhook valida o secret (path {secret} ou header do UazAPI) e responde 200.
// M1 é no-op: só precisa aceitar o webhook pro provider registrar. Decode real = M2.
func waWebhook(cfg config.Config, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !validWhatsAppSecret(cfg, r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		io.Copy(io.Discard, r.Body) // drena; M2 decodifica
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func tgWebhook(cfg config.Config, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Telegram valida via header secret token (setWebhook). Vazio = aceita (M1).
		if cfg.TelegramWebhookSecret != "" &&
			r.Header.Get("X-Telegram-Bot-Api-Secret-Token") != cfg.TelegramWebhookSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		io.Copy(io.Discard, r.Body)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// validWhatsAppSecret: se nenhum secret está configurado, aceita (dev). Senão exige match
// no path {secret} OU num dos headers que o UazAPI manda.
func validWhatsAppSecret(cfg config.Config, r *http.Request) bool {
	want := cfg.WhatsAppWebhookSecret
	if want == "" {
		return true
	}
	if r.PathValue("secret") == want {
		return true
	}
	return r.Header.Get("x-uazapi-webhook-secret") == want ||
		r.Header.Get("x-webhook-secret") == want
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// logMiddleware registra método, rota, status e duração de cada request (observabilidade básica).
func logMiddleware(next http.Handler, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		log.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", sw.status,
			"dur_ms", time.Since(start).Milliseconds(),
		)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}
