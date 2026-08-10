package store

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type Profile struct {
	ID       string
	TenantID string
	Role     string
	FullName string
}

// ResolveProfile acha o profile vinculado ao chat pelo binding do canal
// (whatsapp_phone / telegram_chat_id). Retorna (nil, nil) se o chat não está vinculado.
func (s *Store) ResolveProfile(ctx context.Context, channel, channelUserID string) (*Profile, error) {
	col := "whatsapp_phone"
	if channel == "telegram" {
		col = "telegram_chat_id"
	}
	var p Profile
	err := s.pool.QueryRow(ctx,
		// col é constante interna (nunca input do usuário) → sem risco de injeção.
		`select id, tenant_id, coalesce(role,''), coalesce(full_name,'') from profiles where `+col+`=$1 limit 1`,
		channelUserID,
	).Scan(&p.ID, &p.TenantID, &p.Role, &p.FullName)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}
