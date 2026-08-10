// Package httpapi monta o mux (Go 1.22+ method routing), decodifica os webhooks e chama o pipeline.
// M2: decode → pipeline.Handle (echo). O envio real ao provider (outbound channel) é M2b.
package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/Gsfrota/efinance-bot-go/internal/config"
	"github.com/Gsfrota/efinance-bot-go/internal/pipeline"
	"github.com/Gsfrota/efinance-bot-go/internal/store"
)

// Version é sobrescrito via -ldflags "-X ...httpapi.Version=<sha>" no build.
var Version = "dev"

func NewMux(cfg config.Config, log *slog.Logger, st *store.Store) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health)
	mux.HandleFunc("POST /webhook/whatsapp/{secret}", waWebhook(cfg, log, st))
	mux.HandleFunc("POST /webhook/telegram", tgWebhook(cfg, log, st))
	return logMiddleware(mux, log)
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": Version,
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}

func waWebhook(cfg config.Config, log *slog.Logger, st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !validWhatsAppSecret(cfg, r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if in, ok := decodeWhatsApp(body); ok {
			process(r.Context(), log, st, in)
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true}) // sempre 200: provider não deve re-tentar
	}
}

func tgWebhook(cfg config.Config, log *slog.Logger, st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg.TelegramWebhookSecret != "" &&
			r.Header.Get("X-Telegram-Bot-Api-Secret-Token") != cfg.TelegramWebhookSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if in, ok := decodeTelegram(body); ok {
			process(r.Context(), log, st, in)
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// process roda o pipeline e, por ora (M2), loga a reply. O envio ao provider entra no M2b.
func process(ctx context.Context, log *slog.Logger, st *store.Store, in pipeline.Inbound) {
	if st == nil {
		log.Warn("sem store: mensagem não processada", "channel", in.Channel)
		return
	}
	reply, err := pipeline.Handle(ctx, st, in)
	if err != nil {
		log.Error("pipeline", "err", err, "channel", in.Channel)
		return
	}
	log.Info("reply", "channel", in.Channel, "user", in.ChannelUserID, "texts", reply.Texts)
}

// validWhatsAppSecret: sem secret configurado, aceita (dev). Senão exige match no path ou header.
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
