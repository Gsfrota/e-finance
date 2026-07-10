// Command spike é o M0 descartável da reescrita Go (ver docs/superpowers/specs/2026-07-02-go-rewrite-design.md, A6/M0).
// Prova, localmente, os dois mecanismos de base antes de qualquer pipeline:
//  1. pgx conecta num Postgres e passa os tipos que as RPCs reais usam (uuid, numeric, timestamptz, array) com simple_protocol.
//  2. o SDK genai responde um hello-world (1 chamada mínima — o resto do bot minimiza Gemini por design).
//
// DESCARTÁVEL: apagar após o M1 (esqueleto real em cmd/bot). Não é o binário de produção.
//
// Uso:
//   SPIKE_DATABASE_URL=postgres://postgres:spike@localhost:55432/postgres GEMINI_API_KEY=... go run ./cmd/spike
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"google.golang.org/genai"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	ok := true
	if err := checkPgx(ctx); err != nil {
		fmt.Printf("❌ pgx: %v\n", err)
		ok = false
	} else {
		fmt.Println("✅ pgx: conecta, simple_protocol, e marshaling de uuid/numeric/timestamptz/array OK")
	}

	if err := checkGemini(ctx); err != nil {
		fmt.Printf("❌ genai: %v\n", err)
		ok = false
	} else {
		fmt.Println("✅ genai: hello-world OK")
	}

	if !ok {
		os.Exit(1)
	}
	fmt.Println("\n🟢 M0 verde — pgx e genai provados localmente.")
}

// checkPgx prova o driver + o exec mode do pooler + os tipos que as RPCs reais recebem.
// Risco #1 do M0 (RPC depender de auth.uid()) já foi retirado por inspeção — ver CLAUDE.md.
func checkPgx(ctx context.Context) error {
	dsn := os.Getenv("SPIKE_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:spike@localhost:55432/postgres"
	}

	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return fmt.Errorf("parse dsn: %w", err)
	}
	// ponytail: o pooler transaction-mode (6543) do Supabase quebra prepared statements → simple_protocol.
	// Cravado desde o spike pra o caminho testado ser idêntico ao de prod.
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer conn.Close(ctx)

	var one int
	if err := conn.QueryRow(ctx, "select 1").Scan(&one); err != nil || one != 1 {
		return fmt.Errorf("select 1: got %d, err %w", one, err)
	}

	// Stub com os MESMOS tipos que create_investment_validated recebe, chamado via SELECT func($1,...)
	// — é a convenção exata das RPCs (SELECT create_investment_validated($1,...)). Prova o marshaling.
	const stub = `create or replace function spike_echo(p_id uuid, p_amount numeric, p_at timestamptz, p_dates text[])
	              returns bigint language sql as $$ select 42::bigint $$`
	if _, err := conn.Exec(ctx, stub); err != nil {
		return fmt.Errorf("create stub: %w", err)
	}

	var got int64
	err = conn.QueryRow(ctx, "select spike_echo($1,$2,$3,$4)",
		"00000000-0000-0000-0000-000000000001", // uuid
		"1234.56",                              // numeric (string evita imprecisão de float)
		time.Now(),                             // timestamptz
		[]string{"2026-01-01", "2026-02-01"},   // array (date[] real passa NULL ou cast explícito)
	).Scan(&got)
	if err != nil || got != 42 {
		return fmt.Errorf("call stub: got %d, err %w", got, err)
	}
	return nil
}

// checkGemini faz UMA chamada mínima (flash-lite) só pra provar o SDK. O bot minimiza Gemini por design.
func checkGemini(ctx context.Context) error {
	key := os.Getenv("GEMINI_API_KEY")
	if key == "" {
		key = os.Getenv("API_KEY")
	}
	if key == "" {
		return fmt.Errorf("GEMINI_API_KEY ausente")
	}

	client, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: key, Backend: genai.BackendGeminiAPI})
	if err != nil {
		return fmt.Errorf("new client: %w", err)
	}

	resp, err := client.Models.GenerateContent(ctx, "gemini-2.5-flash-lite",
		genai.Text("Responda apenas com a palavra: OK"),
		&genai.GenerateContentConfig{MaxOutputTokens: 10},
	)
	if err != nil {
		return fmt.Errorf("generate: %w", err)
	}
	fmt.Printf("   resposta gemini: %q\n", resp.Text())
	return nil
}
