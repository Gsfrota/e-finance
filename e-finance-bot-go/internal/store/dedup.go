package store

import "context"

// MarkProcessed insere (channel, externalID). Retorna true se é NOVO; false se já foi processado
// (duplicata). INSERT ON CONFLICT DO NOTHING → dedup sobrevive a restart.
func (s *Store) MarkProcessed(ctx context.Context, channel, externalID string) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`insert into bot_processed_updates (channel, external_id) values ($1,$2)
		 on conflict (channel, external_id) do nothing`,
		channel, externalID,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}
