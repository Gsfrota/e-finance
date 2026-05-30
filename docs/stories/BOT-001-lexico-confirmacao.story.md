# BOT-001 — Léxico de confirmação em mutações sensíveis

**Agentes:** @pm (spec) → @sm → @po → @dev → @qa → @devops
**Status:** Ready for Review
**Criada em:** 2026-05-30
**Sprint:** SPRINT-BOT-01
**Prioridade:** P0 — usabilidade dos fluxos sensíveis (criar contrato / baixar parcela)
**Banco:** sem mudança de schema/RPC

---

## 1. Problema

`parseConfirmationReply` (`src/assistant/confirmation-store.ts`) só aceita
`^(sim|confirmo|ok|pode|isso|s|segue|pode seguir)$` como confirmação. Respostas
coloquiais comuns caem no fallback degradado (a mutação **não** ocorre e o usuário
fica sem entender): `beleza, blz, bora, certo, combinado, isso mesmo, perfeito,
pode confirmar, pode ser, ta, tá, yes`. Afeta exatamente os fluxos admin com
`requiresConfirmation` (`create_contract`, `mark_installment_paid`).

## 2. Tensão de design (mutação financeira)

Equilíbrio **recall × falso-positivo**: aceitar mais palavras de "sim" sem que algo
ambíguo dispare uma baixa/criação por engano. Mitigação: regex **ancorada** (`^...$`)
— "pode ser" (exato) confirma, mas "pode ser que…", "acho que sim", "talvez" **não**
casam (têm mais tokens) e nunca confirmam.

## 3. Acceptance Criteria

- **AC-1:** Palavras coloquiais afirmativas exatas confirmam a pendência:
  `beleza, blz, bora, certo, combinado, isso mesmo, perfeito, pode confirmar,
  pode ser, ta, tá, yes` (+ as já aceitas).
- **AC-2 (sem falso-positivo):** Respostas tentativas/ambíguas **não** confirmam:
  `talvez, acho que sim, pode ser que sim, deixa eu ver, espera, mais ou menos`.
- **AC-3:** Cancelamento robusto: `não, nao, cancela, cancelar, para, parar, sair,
  deixa, negativo, nope, melhor não` cancelam.
- **AC-4:** Normalização tolerante a acento e pontuação final (`Sim!`, `OK.`, `tá`
  → confirmam; `Não!` → cancela).
- **AC-5:** chunk-03 (`confirm-lexicon`) atinge **50/50**; o gate de estresse
  (`stress-baixa-confirmacao-ambigua-nao-executa`, "talvez") segue verde.

## 4. Implementação

`src/assistant/confirmation-store.ts` → `parseConfirmationReply`:
- Normaliza: `trim().toLowerCase()` + strip de acentos (NFD) + remove pontuação/espaço
  final.
- Léxico de confirmação ampliado (ancorado), incluindo as coloquiais afirmativas.
- Léxico de cancelamento ampliado (ancorado).
- Ambíguos ficam de fora por construção (não constam no conjunto e a âncora barra
  frases maiores).

## 5. Evidências

- `tests/eval-dump.test.ts` → `confirmationLexicon.accepted/ignored` no scorecard.
- chunk-03 50/50 (todas as palavras tolerantes confirmam).
- `tests/stress-flows.test.ts`: "talvez" não executa (mantido verde).
- `npm test` verde; `tsc --noEmit` 0.

## 6. QA Gate (@qa — 2026-05-30)

- [x] AC-1..AC-5 verificados.
- [x] `tests/confirmation-lexicon.test.ts` (50/50): recall coloquial + acento/pontuação/caixa; cancelamento; **ambíguos** (`talvez, acho que sim, pode ser que sim, mais ou menos, espera, deixa eu ver…`) não confirmam.
- [x] chunk-03 (`confirm-lexicon`) → `confirmationLexicon.ignored: []` (todas as 50 tolerantes confirmam).
- [x] `tests/stress-flows.test.ts` segue verde, incl. "talvez" não executa.
- [x] `npm test` **312 passed / 4 skipped** (+50 do gate de léxico); `tsc --noEmit` 0.
- **Verdict:** ✅ **PASS** — pronto para `@devops *push` (push = deploy prod).
