// Package config é a fonte única de verdade das env vars (espelha os nomes do e-finance-bot/src/config.ts).
package config

import (
	"os"
	"strings"
)

type Config struct {
	Port     string // Railway injeta PORT; default 8080 pro dev local
	Env      string // "dev" | "prod"
	LogLevel string // slog level: debug|info|warn|error

	DatabaseURL    string // DSN do pooler Supabase (pgx) — vazio até o deploy fornecer
	SupabaseURL    string
	ServiceRoleKey string
	GeminiAPIKey   string

	UazapiServerURL       string
	UazapiInstanceToken   string
	WhatsAppWebhookSecret string

	TelegramBotToken      string
	TelegramWebhookSecret string

	SchedulerSecret string

	// Gemini-min (decisão do usuário 10/07): naturalização LLM DESLIGADA por default.
	// Só liga com LLM_RESPONSE_ENABLED=true. Ver CLAUDE.md do módulo.
	LLMResponseEnabled bool
}

// Load lê o ambiente com defaults sãos. Não falha por secret ausente — o /health precisa
// subir sem banco (M1). Validação estrita fica pra quando cada dependência for de fato usada.
func Load() Config {
	return Config{
		Port:     getenv("PORT", "8080"),
		Env:      getenv("ENV", "dev"),
		LogLevel: getenv("LOG_LEVEL", "info"),

		DatabaseURL:    os.Getenv("DATABASE_URL"),
		SupabaseURL:    os.Getenv("SUPABASE_URL"),
		ServiceRoleKey: os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		GeminiAPIKey:   firstNonEmpty(os.Getenv("GEMINI_API_KEY"), os.Getenv("API_KEY")),

		UazapiServerURL:       getenv("UAZAPI_SERVER_URL", "https://processai.uazapi.com"),
		UazapiInstanceToken:   os.Getenv("UAZAPI_INSTANCE_TOKEN"),
		WhatsAppWebhookSecret: strings.TrimSpace(os.Getenv("UAZAPI_WEBHOOK_SECRET")),

		TelegramBotToken:      os.Getenv("TELEGRAM_BOT_TOKEN"),
		TelegramWebhookSecret: strings.TrimSpace(os.Getenv("TELEGRAM_WEBHOOK_SECRET_TOKEN")),

		// config.ts trima: o secret no Secret Manager vinha com \n no fim.
		SchedulerSecret: strings.TrimSpace(os.Getenv("SCHEDULER_SECRET")),

		LLMResponseEnabled: os.Getenv("LLM_RESPONSE_ENABLED") == "true",
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
