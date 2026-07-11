// Package pipeline orquestra o processamento de uma mensagem. M2 = echo (dedup → sessão →
// linking → resposta). Os estágios reais (router regex, nlu, tools, policy) entram no M3/M4.
package pipeline

import (
	"context"

	"github.com/Gsfrota/efinance-bot-go/internal/store"
)

// Inbound é a mensagem normalizada, agnóstica ao canal (o decode por-provider produz isto).
type Inbound struct {
	Channel       string
	ChannelUserID string
	Text          string
	ExternalID    string // id do provider p/ dedup (messageid do UazAPI / update_id do Telegram)
}

// Reply é o que o pipeline devolve; o caller (httpapi) entrega por canal. Sem interface de canal.
type Reply struct{ Texts []string }

func Handle(ctx context.Context, st *store.Store, in Inbound) (Reply, error) {
	// dedup: mensagem já processada não gera resposta (sobrevive a restart).
	if in.ExternalID != "" {
		fresh, err := st.MarkProcessed(ctx, in.Channel, in.ExternalID)
		if err != nil {
			return Reply{}, err
		}
		if !fresh {
			return Reply{}, nil
		}
	}

	if _, err := st.GetOrCreateSession(ctx, in.Channel, in.ChannelUserID); err != nil {
		return Reply{}, err
	}

	prof, err := st.ResolveProfile(ctx, in.Channel, in.ChannelUserID)
	if err != nil {
		return Reply{}, err
	}

	// echo (M2): prova o fluxo ponta a ponta com side-effect real no banco.
	if prof != nil {
		return Reply{Texts: []string{"Olá, " + prof.FullName + "! Recebi: " + in.Text}}, nil
	}
	return Reply{Texts: []string{"Recebi: " + in.Text + " (chat ainda não vinculado)"}}, nil
}
