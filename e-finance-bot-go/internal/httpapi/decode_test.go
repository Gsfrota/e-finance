package httpapi

import "testing"

func TestDecodeWhatsApp(t *testing.T) {
	in, ok := decodeWhatsApp([]byte(`{"message":{"fromMe":false,"text":"oi","sender_pn":"5511999998888@s.whatsapp.net","messageid":"ABC"}}`))
	if !ok {
		t.Fatal("esperava ok")
	}
	if in.Channel != "whatsapp" || in.Text != "oi" || in.ExternalID != "ABC" {
		t.Fatalf("got %+v", in)
	}
	if in.ChannelUserID != "5511999998888" {
		t.Fatalf("phone tirou o JID? got %q", in.ChannelUserID)
	}

	drops := map[string]string{
		"fromMe":   `{"message":{"fromMe":true,"text":"x","sender_pn":"55@s"}}`,
		"grupo":    `{"message":{"isGroup":true,"text":"x","sender_pn":"55@s"}}`,
		"sem texto": `{"message":{"sender_pn":"55@s"}}`,
		"lixo":     `nao-e-json`,
	}
	for name, body := range drops {
		if _, ok := decodeWhatsApp([]byte(body)); ok {
			t.Errorf("%s deveria dropar", name)
		}
	}
}

func TestDecodeTelegram(t *testing.T) {
	in, ok := decodeTelegram([]byte(`{"update_id":42,"message":{"message_id":7,"text":"oi","chat":{"id":12345}}}`))
	if !ok {
		t.Fatal("esperava ok")
	}
	if in.Channel != "telegram" || in.ChannelUserID != "12345" || in.Text != "oi" || in.ExternalID != "42" {
		t.Fatalf("got %+v", in)
	}
	if _, ok := decodeTelegram([]byte(`{"update_id":1}`)); ok {
		t.Fatal("sem message deveria dropar")
	}
}
