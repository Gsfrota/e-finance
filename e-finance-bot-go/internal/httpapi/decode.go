package httpapi

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/Gsfrota/efinance-bot-go/internal/pipeline"
)

// decodeWhatsApp extrai o essencial do payload UazAPI (formato aninhado real + flat de teste).
// ok=false = ignorar (fromMe, grupo, sem texto/usuário).
func decodeWhatsApp(body []byte) (pipeline.Inbound, bool) {
	var p struct {
		Message struct {
			FromMe    bool   `json:"fromMe"`
			IsGroup   bool   `json:"isGroup"`
			Text      string `json:"text"`
			SenderPN  string `json:"sender_pn"`
			ChatID    string `json:"chatid"`
			MessageID string `json:"messageid"`
		} `json:"message"`
		// fallback flat (payloads de teste)
		FromMe    bool   `json:"fromMe"`
		Text      string `json:"text"`
		Sender    string `json:"sender"`
		MessageID string `json:"messageid"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		return pipeline.Inbound{}, false
	}
	fromMe := p.Message.FromMe || p.FromMe
	text := firstNonEmpty(p.Message.Text, p.Text)
	user := firstNonEmpty(p.Message.SenderPN, p.Message.ChatID, p.Sender)
	extID := firstNonEmpty(p.Message.MessageID, p.MessageID)
	if fromMe || p.Message.IsGroup || text == "" || user == "" {
		return pipeline.Inbound{}, false
	}
	return pipeline.Inbound{
		Channel:       "whatsapp",
		ChannelUserID: extractPhone(user),
		Text:          text,
		ExternalID:    extID,
	}, true
}

// decodeTelegram extrai o essencial de um update do Telegram Bot API.
func decodeTelegram(body []byte) (pipeline.Inbound, bool) {
	var p struct {
		UpdateID int64 `json:"update_id"`
		Message  struct {
			MessageID int64  `json:"message_id"`
			Text      string `json:"text"`
			Chat      struct {
				ID int64 `json:"id"`
			} `json:"chat"`
		} `json:"message"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		return pipeline.Inbound{}, false
	}
	if p.Message.Text == "" || p.Message.Chat.ID == 0 {
		return pipeline.Inbound{}, false
	}
	return pipeline.Inbound{
		Channel:       "telegram",
		ChannelUserID: strconv.FormatInt(p.Message.Chat.ID, 10),
		Text:          p.Message.Text,
		ExternalID:    strconv.FormatInt(p.UpdateID, 10),
	}, true
}

// extractPhone tira o JID do WhatsApp e deixa só dígitos.
// ponytail: normalização BR (inserir o 9 em 12 dígitos) fica pro M2b — o binding em prod já guarda normalizado.
func extractPhone(jid string) string {
	if i := strings.IndexByte(jid, '@'); i >= 0 {
		jid = jid[:i]
	}
	var b strings.Builder
	for _, r := range jid {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
