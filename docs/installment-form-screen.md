# InstallmentFormScreen — Componente compartilhado de ação de parcela

## Localização

`components/InstallmentDetailFlow.tsx` — exportado na linha 251.

## O que é

Tela de ação sobre uma parcela individual. Suporta:

| `action.type` | Comportamento |
|---------------|---------------|
| `pay`         | Dar baixa (total ou parcial) com fluxo 2-etapas |
| `refinance`   | Prorrogar vencimento |
| `edit`        | Editar valor e data da parcela |
| `interest`    | Cobrar apenas juros |
| `unpay`       | Estornar baixa |

## Fluxo de baixa parcial (step 2)

Quando o valor digitado é **menor que o total da parcela**, ao clicar "Próximo" aparece o step 2 com 3 opções:

1. **Repassar saldo à última parcela** (com ou sem juros de 2%)
2. **Adicionar à próxima parcela**
3. **Criar nova parcela** no final do contrato (com ou sem juros de 2%)

A lógica de cada opção chama a RPC `apply_remainder_action` no Supabase.

## Props

```typescript
interface InstallmentFormScreenProps {
  action: NonNullable<InstallmentAction>; // { type, installment }
  tenant: Tenant | null;
  payerName?: string;
  onBack: () => void;
  onSuccess: () => void;
}
```

## Como usar

```typescript
import { InstallmentFormScreen } from './InstallmentDetailFlow';

// No render do componente pai:
if (installmentAction !== null) {
  return (
    <InstallmentFormScreen
      action={installmentAction}
      tenant={tenant}
      payerName={payer.full_name}
      onBack={() => setInstallmentAction(null)}
      onSuccess={() => { setInstallmentAction(null); refetch(); }}
    />
  );
}
```

## Onde é usado

| Componente | Arquivo |
|------------|---------|
| CollectionDashboard (via InstallmentDetailFlow) | `components/dashboard/CollectionDashboard.tsx` |
| AdminUserDetails | `components/AdminUserDetails.tsx` |
| ContractDetail | `components/ContractDetail.tsx` |

## Outros exports de InstallmentDetailFlow.tsx

| Export | Uso |
|--------|-----|
| `InstallmentAction` (type) | Tipo do estado de ação |
| `fmtMoney` | Formata BRL |
| `fmtDate` | Formata `YYYY-MM-DD` → `DD/MM/YYYY` |

## Histórico

Antes desta refatoração, `AdminUserDetails.tsx` e `ContractDetail.tsx` tinham cópias locais desatualizadas do `InstallmentFormScreen` — sem o step 2 de baixa parcial. As cópias foram removidas em favor deste export compartilhado.
