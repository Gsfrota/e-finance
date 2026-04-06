# HIST-001 — [UX] Design do evento "Atrasada" no histórico de parcelas

**Agente:** @ux  
**Status:** Done  
**BR:** BR-PAG-021  
**Criada em:** 2026-04-05  
**Depende de:** Nenhuma  
**Bloqueante para:** HIST-002 (frontend)

---

## Contexto

O sistema detecta automaticamente parcelas vencidas via cron diário (`update_overdue_installments`) e marca o status como `late`. Esta transição **não aparece no histórico** do contrato — o admin não sabe quando o atraso foi detectado.

A BR-PAG-021 exige que cada transição `pending → late` gere um registro `payment_transactions.transaction_type = 'late_auto'`. Este evento deve aparecer no `InstallmentHistory.tsx` como "Atrasada", **distinto** de "Falta registrada" (`missed`).

### Diferença conceitual a comunicar visualmente

| Evento | `transaction_type` | Significado |
|--------|--------------------|-------------|
| **Atrasada** (novo) | `late_auto` | Sistema detectou que parcela venceu sem pagamento — sem ação financeira |
| **Falta registrada** (já existe) | `missed` | Admin decidiu registrar falta e redistribuiu o valor da parcela |

---

## Objetivo da Task

Definir a aparência e comportamento do novo item `late_auto` no componente `InstallmentHistory.tsx`.

---

## Decisões de Design Necessárias

### 1. Identidade visual do evento

O arquivo `InstallmentHistory.tsx:26-33` já tem o mapeamento `TX_META`:

```tsx
// Existentes:
payment:          { icon: '●', label: 'Pagamento',           color: 'var(--accent-positive)' },
surplus_applied:  { icon: '▸', label: 'Surplus aplicado',    color: 'var(--accent-caution)' },
surplus_received: { icon: '◆', label: 'Recebido via surplus', color: 'var(--accent-purple)' },
deferred:         { icon: '⇢', label: 'Postergado',           color: 'var(--accent-caution)' },
missed:           { icon: '⚠', label: 'Falta registrada',    color: 'var(--accent-warning)' },
reversal:         { icon: '✕', label: 'Estorno',              color: 'var(--accent-danger)' },

// NOVO — definir:
late_auto:        { icon: '?', label: '?',                    color: '?' },
```

**Definir para `late_auto`:**
- [ ] Ícone (sugestões: `⏰`, `⚡`, `!`, `▲`)
- [ ] Label PT-BR (sugestões: "Atrasada", "Atraso detectado", "Vencimento sem pagamento")
- [ ] Cor CSS (sugestão: tom amber/laranja `var(--accent-danger)` dimmed, ou nova variável)

### 2. Posicionamento na view "Por Recebimento"

O `InstallmentHistory` tem duas views:
- **Por Recebimento** — agrupa por `receipt_id`, foca em dinheiro que entrou
- **Por Parcela** — lista todos os eventos de uma parcela

`late_auto` não é um recebimento (amount = 0). Definir:
- [ ] Aparece na view "Por Recebimento"? (recomendação: **não** — confunde com entradas financeiras)
- [ ] Aparece apenas na view "Por Parcela"? (recomendação: **sim** — é um evento de status)

### 3. Informação adicional

- [ ] Mostrar dias de atraso? Ex: "Atrasada há 5 dias" (`CURRENT_DATE - due_date`)
- [ ] Mostrar fine_amount que foi aplicado? (relaciona com BR-CNT-010)

---

## Entregáveis Esperados

1. **Especificação visual** (pode ser texto descritivo ou sketch):
   - Entrada para `TX_META.late_auto`: icon, label, color
   - Comportamento nas duas views

2. **Mockup ou descrição** de como o item aparece na lista de eventos de uma parcela atrasada

---

## Especificação Final — Decisões Tomadas

### TX_META entrada
```tsx
late_auto: { icon: '▲', label: 'Atraso detectado', color: 'var(--accent-brass)' },
```

### Views
- **Por Recebimento**: ❌ filtrar `late_auto` na linha 66 (evento não-financeiro, amount=0)
- **Por Parcela**: ✅ exibir como sub-row sem valor monetário, com `há Xd` de dias de atraso

### Renderização
```
▲  05/04/2026 03:05 — Atraso detectado · há 3d
```
(sem valor à direita — omitir o `fmtMoney` para `late_auto`)

## Critérios de Aceite

- [x] `late_auto` visualmente distinto de `missed` (`▲` brass vs `⚠` warning)
- [x] `late_auto` sem valor monetário exibido
- [x] Label "Atraso detectado" em PT-BR
- [x] Não aparece na view "Por Recebimento" — filtrado explicitamente
