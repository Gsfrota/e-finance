package pipeline

import (
	"context"
	"os"
	"strings"
	"testing"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"

	"github.com/Gsfrota/efinance-bot-go/internal/store"
)

// Integração contra Postgres. Usa TEST_DATABASE_URL se setado; senão sobe um embedded-postgres
// in-process (sem Docker). Pula se não conseguir subir (ex.: sem rede pra baixar o binário).
func testStore(t *testing.T) *store.Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		pg := embeddedpostgres.NewDatabase(embeddedpostgres.DefaultConfig().Port(55434))
		if err := pg.Start(); err != nil {
			t.Skipf("embedded-postgres não subiu (sem rede? docker?): %v", err)
		}
		t.Cleanup(func() { _ = pg.Stop() })
		dsn = "postgres://postgres:postgres@localhost:55434/postgres"
	}
	ctx := context.Background()
	st, err := store.New(ctx, dsn)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(st.Close)

	schema, err := os.ReadFile("../../tests/testdata/schema.sql")
	if err != nil {
		t.Fatalf("ler schema: %v", err)
	}
	if err := st.Exec(ctx, string(schema)); err != nil {
		t.Fatalf("aplicar schema: %v", err)
	}
	if err := st.Exec(ctx, "truncate profiles, bot_sessions, bot_processed_updates"); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return st
}

func TestHandleEchoLinkDedup(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	const tenant = "11111111-1111-1111-1111-111111111111"
	const pid = "22222222-2222-2222-2222-222222222222"
	if err := st.Exec(ctx, `insert into profiles (id, tenant_id, full_name, role, whatsapp_phone)
		values ('`+pid+`','`+tenant+`','Maria','admin','5511999998888')`); err != nil {
		t.Fatal(err)
	}

	in := Inbound{Channel: "whatsapp", ChannelUserID: "5511999998888", Text: "quanto recebi", ExternalID: "MSG1"}

	// 1) vinculado → saudação com o nome
	rep, err := Handle(ctx, st, in)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Texts) != 1 || !strings.Contains(rep.Texts[0], "Maria") {
		t.Fatalf("esperava saudação p/ Maria, got %+v", rep.Texts)
	}

	// 2) dedup: mesmo ExternalID → sem resposta
	rep2, err := Handle(ctx, st, in)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep2.Texts) != 0 {
		t.Fatalf("dedup deveria dropar, got %+v", rep2.Texts)
	}

	// 3) chat não vinculado → echo genérico
	rep3, err := Handle(ctx, st, Inbound{Channel: "whatsapp", ChannelUserID: "5511000000000", Text: "oi", ExternalID: "MSG2"})
	if err != nil {
		t.Fatal(err)
	}
	if len(rep3.Texts) != 1 || !strings.Contains(rep3.Texts[0], "não vinculado") {
		t.Fatalf("got %+v", rep3.Texts)
	}

	// 4) sessão persistida (side-effect real no banco)
	sess, err := st.GetOrCreateSession(ctx, "whatsapp", "5511999998888")
	if err != nil {
		t.Fatal(err)
	}
	if sess.ID == "" {
		t.Fatal("sessão não criada")
	}
}
