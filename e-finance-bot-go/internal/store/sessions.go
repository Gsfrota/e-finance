package store

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

type Session struct {
	ID            string
	ProfileID     *string
	Channel       string
	ChannelUserID string
	Context       json.RawMessage
}

const sessionCols = `id, profile_id, channel, channel_user_id, context`

// GetOrCreateSession acha a sessão do (canal, usuário) ou cria uma vazia.
// ponytail: SELECT-depois-INSERT; corrida é inofensiva com --max-instances=1 (índice único cobre).
func (s *Store) GetOrCreateSession(ctx context.Context, channel, channelUserID string) (*Session, error) {
	var sess Session
	err := s.pool.QueryRow(ctx,
		`select `+sessionCols+` from bot_sessions where channel=$1 and channel_user_id=$2`,
		channel, channelUserID,
	).Scan(&sess.ID, &sess.ProfileID, &sess.Channel, &sess.ChannelUserID, &sess.Context)
	if err == nil {
		return &sess, nil
	}
	if err != pgx.ErrNoRows {
		return nil, err
	}
	err = s.pool.QueryRow(ctx,
		`insert into bot_sessions (channel, channel_user_id) values ($1,$2) returning `+sessionCols,
		channel, channelUserID,
	).Scan(&sess.ID, &sess.ProfileID, &sess.Channel, &sess.ChannelUserID, &sess.Context)
	if err != nil {
		return nil, err
	}
	return &sess, nil
}
