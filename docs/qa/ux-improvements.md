# Propostas de Melhoria UX/UI — E-Finance SaaS

**Documento produzido por:** Uma (UX/UI Design Expert)
**Data:** 2026-03-04
**Versão:** 1.0
**Escopo:** Análise completa de usabilidade e experiência do usuário para implementação pelo @dev

---

## Sumário Executivo

A plataforma E-Finance possui uma base visual sólida — tema dark bem definido, tipografia consistente e componentes que expressam sofisticação financeira. O sistema já conta com sidebar responsiva, mobile overlay e alguma animação via `animate-fade-in`. Porém, existem lacunas críticas em: estados de carregamento, feedback de formulários, acessibilidade via teclado, hierarquia visual em tabelas mobile e o fluxo de pagamento PIX.

As 18 propostas abaixo são ordenadas por impacto e praticidade de implementação. Cada uma inclui código Tailwind/React pronto para uso.

---

## Índice de Propostas

| ID | Componente | Severidade | Área |
|----|-----------|-----------|------|
| UX-01 | `DashboardWidgets.tsx` | P0 | Estados de carregamento (skeleton) |
| UX-02 | `PaymentModal.tsx` | P0 | Countdown timer do QR Code PIX |
| UX-03 | `Login.tsx` | P0 | Indicador de força de senha |
| UX-04 | `AdminContracts.tsx` | P0 | Feedback inline de validação de formulário |
| UX-05 | `App.tsx` | P1 | Skip-to-content para acessibilidade |
| UX-06 | `DashboardWidgets.tsx` | P1 | Estados vazios com ilustração e CTA |
| UX-07 | `Dashboard.tsx` | P1 | Scroll horizontal em tabs no mobile |
| UX-08 | `DashboardWidgets.tsx` | P1 | Ações de tabela acessíveis via teclado |
| UX-09 | `PaymentModal.tsx` | P1 | Instrução passo-a-passo do fluxo PIX |
| UX-10 | `App.tsx` | P1 | Toast notifications centralizadas |
| UX-11 | `AdminUsers.tsx` | P1 | Cards de usuário com skeleton loading |
| UX-12 | `DebtorDashboard.tsx` | P1 | Animação de accordion com altura CSS |
| UX-13 | `InvestorDashboard.tsx` | P1 | Filtro e busca na lista de investimentos |
| UX-14 | `Login.tsx` | P2 | Toggle para mostrar/ocultar senha |
| UX-15 | `AdminSettings.tsx` | P2 | Preview do logo em tempo real |
| UX-16 | `DashboardWidgets.tsx` | P2 | Tooltip rico nos gráficos Recharts |
| UX-17 | `App.tsx` | P2 | Indicador de role do usuário no header mobile |
| UX-18 | Global | P2 | Focus ring acessível e consistente |

---

## Propostas Detalhadas

---

### UX-01 — Skeleton Loading no Dashboard

**Componente:** `components/dashboard/DashboardWidgets.tsx`
**Impacto:** Todos os usuários admin. Severidade **P0** — o estado atual mostra um spinner centralizado por vários segundos sem nenhuma estrutura visual, causando sensação de tela quebrada.

**Problema:**
O `AdminDashboardView` em `Dashboard.tsx` (linha 39-46) mostra apenas um `<Loader2>` girando no centro por toda a altura de 96 unidades (`h-96`). Não há skeleton dos KPI cards, da tabela de recebíveis nem dos gráficos. O usuário não sabe o que vai aparecer, o que aumenta a taxa de bounce percebida.

**Proposta:**
Implementar um componente `<DashboardSkeleton>` que replica o layout real com blocos animados via `animate-pulse`. Deve incluir: 4 cards KPI, 2 gráficos e uma tabela com 5 linhas fantasma.

**Código sugerido:**

```tsx
// Em DashboardWidgets.tsx — adicionar antes do export final

const SkeletonBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`bg-slate-700/50 rounded-2xl animate-pulse ${className}`} />
);

export const DashboardSkeleton: React.FC = () => (
  <div className="space-y-6 pb-12" aria-busy="true" aria-label="Carregando indicadores">
    {/* KPI Cards */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-slate-800 p-6 rounded-[2rem] border border-slate-700 space-y-4">
          <div className="flex justify-between">
            <SkeletonBlock className="w-12 h-12 rounded-2xl" />
            <SkeletonBlock className="w-24 h-6 rounded" />
          </div>
          <SkeletonBlock className="w-3/4 h-8 rounded-xl" />
          <SkeletonBlock className="w-1/2 h-3 rounded" />
        </div>
      ))}
    </div>

    {/* Charts */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      {[...Array(2)].map((_, i) => (
        <div key={i} className="bg-slate-800 p-8 rounded-[2rem] border border-slate-700">
          <SkeletonBlock className="w-48 h-6 mb-8 rounded" />
          <SkeletonBlock className="w-full h-[300px] rounded-xl" />
        </div>
      ))}
    </div>

    {/* Table */}
    <div className="bg-slate-800 rounded-[2rem] border border-slate-700 overflow-hidden">
      <div className="p-6 border-b border-slate-700">
        <SkeletonBlock className="w-64 h-5 rounded" />
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 px-6 border-b border-slate-700/30">
          <SkeletonBlock className="w-10 h-10 rounded-xl shrink-0" />
          <SkeletonBlock className="flex-1 h-4 rounded" />
          <SkeletonBlock className="w-24 h-4 rounded" />
          <SkeletonBlock className="w-20 h-6 rounded-full" />
        </div>
      ))}
    </div>
  </div>
);
```

Em `Dashboard.tsx`, substituir o bloco de loading (linhas 39-46):

```tsx
// Antes:
if (loading) {
  return (
    <div className="flex flex-col items-center justify-center h-96 text-teal-500 animate-pulse">
      <Loader2 size={40} className="animate-spin mb-4" />
      <p className="text-xs font-black uppercase tracking-widest">Carregando Indicadores...</p>
    </div>
  );
}

// Depois:
import { DashboardSkeleton } from './dashboard/DashboardWidgets';

if (loading) return <DashboardSkeleton />;
```

**Critérios de aceitação:**
- [ ] Skeleton aparece imediatamente ao carregar o dashboard admin
- [ ] O skeleton tem a mesma estrutura visual do conteúdo real (4 cards, 2 gráficos, 1 tabela)
- [ ] Animação `animate-pulse` está ativa
- [ ] Atributo `aria-busy="true"` presente no container
- [ ] Transição suave do skeleton para o conteúdo (sem flash)

---

### UX-02 — Countdown Timer no Modal PIX

**Componente:** `components/PaymentModal.tsx`
**Impacto:** Todos os devedores. Severidade **P0** — QR Codes PIX dinâmicos expiram em 30 minutos (padrão BCB). Sem contador, o usuário pode tentar pagar com um QR expirado, gerando frustração e chamadas ao suporte.

**Problema:**
O modal exibe o QR Code mas não informa ao usuário por quanto tempo ele é válido. Após a geração (linha 151), não há temporizador, nem alerta de expiração, nem botão de refresh visível antes do erro.

**Proposta:**
Adicionar um countdown regressivo de 30:00 com barra de progresso. Ao atingir 2:00 restantes, exibir alerta amarelo de "expirando em breve". Ao atingir 0:00, substituir o QR por mensagem de expiração com botão proeminente de regenerar.

**Código sugerido:**

```tsx
// Hook de countdown — adicionar no início do arquivo PaymentModal.tsx

import { useEffect, useRef, useState } from 'react';

const PIX_EXPIRY_SECONDS = 30 * 60; // 30 minutos

const usePixCountdown = (isActive: boolean, onExpire: () => void) => {
  const [secondsLeft, setSecondsLeft] = useState(PIX_EXPIRY_SECONDS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isActive) {
      setSecondsLeft(PIX_EXPIRY_SECONDS);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    setSecondsLeft(PIX_EXPIRY_SECONDS);
    intervalRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          onExpire();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isActive]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const percentLeft = (secondsLeft / PIX_EXPIRY_SECONDS) * 100;
  const isExpiringSoon = secondsLeft <= 120; // 2 minutos

  return { formatted, percentLeft, isExpiringSoon, secondsLeft };
};

// Uso no componente PaymentModal — adicionar após const [copied, setCopied]
const [isExpired, setIsExpired] = useState(false);
const { formatted, percentLeft, isExpiringSoon } = usePixCountdown(
  !!(data && !loading && !error),
  () => setIsExpired(true)
);

// Reset ao abrir/fechar
useEffect(() => {
  if (!isOpen) setIsExpired(false);
}, [isOpen]);

// JSX — substituir a seção QR Code Area (linhas 147-173) por:
{isExpired ? (
  <div className="py-10 flex flex-col items-center gap-4 text-center animate-fade-in">
    <div className="p-4 bg-amber-900/20 rounded-full">
      <AlertTriangle size={48} className="text-amber-400" />
    </div>
    <div>
      <p className="text-white font-black text-lg mb-1">QR Code Expirado</p>
      <p className="text-slate-400 text-xs">O código PIX tem validade de 30 minutos por segurança.</p>
    </div>
    <button
      onClick={() => { setIsExpired(false); generatePix(installment.id); }}
      className="bg-teal-600 hover:bg-teal-500 text-white px-6 py-3 rounded-xl font-black text-xs uppercase flex items-center gap-2 transition-all"
    >
      <RefreshCw size={16} /> Gerar Novo QR Code
    </button>
  </div>
) : (
  <>
    {/* Countdown */}
    <div className="w-full space-y-2" role="timer" aria-live="polite" aria-label={`QR Code válido por ${formatted}`}>
      <div className="flex justify-between items-center text-xs">
        <span className={`font-bold uppercase tracking-widest ${isExpiringSoon ? 'text-amber-400 animate-pulse' : 'text-slate-500'}`}>
          {isExpiringSoon ? 'Expirando em breve' : 'Válido por'}
        </span>
        <span className={`font-mono font-black text-base ${isExpiringSoon ? 'text-amber-400' : 'text-white'}`}>
          {formatted}
        </span>
      </div>
      <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${isExpiringSoon ? 'bg-amber-500' : 'bg-teal-500'}`}
          style={{ width: `${percentLeft}%` }}
        />
      </div>
    </div>

    {/* QR Code + Copy existente */}
    <div className="bg-white p-4 rounded-2xl shadow-lg shadow-black/50 relative">
      <div className="absolute -top-3 -right-3 bg-green-500 text-white p-1 rounded-full shadow-lg border-2 border-slate-800 z-10">
        <CheckCircle2 size={16} />
      </div>
      <QRCodeCanvas value={data.payload} size={224} level={"H"} />
    </div>
    {/* ... resto do código de cópia ... */}
  </>
)}
```

**Critérios de aceitação:**
- [ ] Countdown regressivo de 30:00 aparece abaixo do QR Code assim que gerado
- [ ] Barra de progresso decrementa suavemente a cada segundo
- [ ] Nos últimos 2 minutos, contador e barra ficam âmbar com `animate-pulse`
- [ ] Ao expirar, QR é substituído pela tela de expiração com botão de regenerar
- [ ] Atributos `role="timer"` e `aria-live="polite"` presentes para leitores de tela
- [ ] Reset ocorre corretamente ao fechar e reabrir o modal

---

### UX-03 — Indicador de Força de Senha

**Componente:** `components/Login.tsx`
**Impacto:** Novos administradores e usuários convidados. Severidade **P0** — senhas fracas comprometem a segurança de dados financeiros. Atualmente `minLength={6}` é a única proteção (linha 187).

**Problema:**
O campo de senha no signup (`signUpAdmin` e `signUpInvited`) não fornece nenhum feedback visual sobre a complexidade da senha. O usuário pode criar uma senha `123456` sem qualquer aviso.

**Proposta:**
Adicionar barra de força de senha (4 níveis: Fraca / Razoável / Boa / Forte) visível apenas nos modos de cadastro. A barra aparece ao usuário começar a digitar.

**Código sugerido:**

```tsx
// Adicionar função helper antes do componente Login

const getPasswordStrength = (pwd: string): { level: 0 | 1 | 2 | 3 | 4; label: string; color: string } => {
  if (!pwd) return { level: 0, label: '', color: '' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  if (score <= 1) return { level: 1, label: 'Fraca', color: 'bg-red-500' };
  if (score === 2) return { level: 2, label: 'Razoável', color: 'bg-amber-500' };
  if (score === 3) return { level: 3, label: 'Boa', color: 'bg-blue-500' };
  return { level: 4, label: 'Forte', color: 'bg-emerald-500' };
};

// Dentro do componente, adicionar após o estado de password:
const strength = authMode !== 'login' ? getPasswordStrength(password) : null;

// JSX — substituir o input de senha atual (linha 187) por:
<div className="space-y-2">
  <input
    required
    type="password"
    value={password}
    onChange={(e) => setPassword(e.target.value)}
    minLength={6}
    className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:border-teal-500 outline-none transition-colors"
    placeholder="Senha de Acesso"
    aria-describedby={strength ? "password-strength" : undefined}
  />
  {strength && password.length > 0 && (
    <div id="password-strength" className="space-y-1.5 animate-fade-in-down">
      <div className="flex gap-1.5">
        {[1, 2, 3, 4].map(level => (
          <div
            key={level}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
              strength.level >= level ? strength.color : 'bg-slate-700'
            }`}
          />
        ))}
      </div>
      <p className={`text-[10px] font-bold uppercase tracking-widest ${
        strength.level <= 1 ? 'text-red-400' :
        strength.level === 2 ? 'text-amber-400' :
        strength.level === 3 ? 'text-blue-400' : 'text-emerald-400'
      }`}>
        Senha {strength.label}
        {strength.level <= 2 && ' — use letras maiúsculas, números e símbolos'}
      </p>
    </div>
  )}
</div>
```

**Critérios de aceitação:**
- [ ] Indicador de força aparece apenas nos modos `signUpAdmin` e `signUpInvited`
- [ ] 4 segmentos coloridos refletem nível real da senha em tempo real
- [ ] Dica textual orienta o usuário em senhas fracas/razoáveis
- [ ] Não aparece no modo login
- [ ] Atributo `aria-describedby` conecta input ao indicador

---

### UX-04 — Validação Inline em Formulário de Contratos

**Componente:** `components/AdminContracts.tsx`
**Impacto:** Administradores. Severidade **P0** — formulário com 10+ campos sem feedback por campo. Erros só são exibidos ao submeter, forçando o admin a descobrir qual campo está errado após preencher tudo.

**Problema:**
O `AdminContracts` usa um único estado de erro geral. Campos como valor do investimento, taxa de juros e número de parcelas não têm feedback individual ao sair do campo (`onBlur`).

**Proposta:**
Criar um hook `useFieldValidation` e aplicar validação `onBlur` em campos críticos. Adicionar borda vermelha + mensagem inline embaixo do campo com erro.

**Código sugerido:**

```tsx
// Hook reutilizável — criar em hooks/useFieldValidation.ts

export const useFieldValidation = () => {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const setError = (field: string, message: string) => {
    setFieldErrors(prev => ({ ...prev, [field]: message }));
  };

  const clearError = (field: string) => {
    setFieldErrors(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateRequired = (field: string, value: string, label: string) => {
    if (!value.trim()) {
      setError(field, `${label} é obrigatório.`);
      return false;
    }
    clearError(field);
    return true;
  };

  const validatePositiveNumber = (field: string, value: number, label: string, max?: number) => {
    if (isNaN(value) || value <= 0) {
      setError(field, `${label} deve ser maior que zero.`);
      return false;
    }
    if (max && value > max) {
      setError(field, `${label} não pode exceder ${max}.`);
      return false;
    }
    clearError(field);
    return true;
  };

  return { fieldErrors, setError, clearError, validateRequired, validatePositiveNumber };
};

// Componente de campo com erro — adicionar em AdminContracts.tsx

const FieldWrapper: React.FC<{
  label: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
}> = ({ label, error, children, required }) => (
  <div className="space-y-1.5">
    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
      {label}{required && <span className="text-red-400 ml-1">*</span>}
    </label>
    <div className={`transition-all duration-200 ${error ? 'ring-1 ring-red-500 rounded-xl' : ''}`}>
      {children}
    </div>
    {error && (
      <p className="text-red-400 text-[10px] font-medium flex items-center gap-1 animate-fade-in-down" role="alert">
        <AlertCircle size={10} /> {error}
      </p>
    )}
  </div>
);

// Uso no formulário — exemplo para o campo de valor:
<FieldWrapper label="Valor do Investimento" error={fieldErrors.amount} required>
  <input
    type="number"
    value={amount}
    onChange={(e) => setAmount(e.target.value)}
    onBlur={() => validatePositiveNumber('amount', Number(amount), 'Valor do investimento')}
    className={`w-full bg-slate-900/50 border rounded-xl px-4 py-3 text-sm text-white outline-none transition-colors ${
      fieldErrors.amount ? 'border-red-500 focus:border-red-400' : 'border-slate-800 focus:border-teal-500'
    }`}
    placeholder="0,00"
  />
</FieldWrapper>
```

**Critérios de aceitação:**
- [ ] Validação `onBlur` em campos: valor, taxa, parcelas, nome do ativo
- [ ] Campo com erro exibe borda vermelha + mensagem embaixo com ícone
- [ ] Mensagem some ao corrigir o valor
- [ ] Atributo `role="alert"` presente nas mensagens de erro
- [ ] Label com asterisco vermelho para campos obrigatórios

---

### UX-05 — Skip-to-Content para Acessibilidade

**Componente:** `App.tsx`
**Impacto:** Usuários com deficiência visual/motora usando teclado ou leitor de tela. Severidade **P1** — sem link de pulo, usuários de teclado são obrigados a navegar por todo o sidebar antes de chegar ao conteúdo principal.

**Problema:**
Não existe link "Pular para o conteúdo" no topo da página. O sidebar tem 5+ itens de navegação que precisam ser tabulados antes de chegar ao `<main>`.

**Proposta:**
Adicionar link visualmente oculto (mas visível ao receber foco via teclado) antes do sidebar.

**Código sugerido:**

```tsx
// Em App.tsx, dentro do return do componente Layout, ANTES do <aside>:

<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:bg-teal-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-xl focus:font-bold focus:text-sm focus:shadow-xl focus:outline-none"
>
  Pular para o conteúdo principal
</a>

// E adicionar id no <main>:
<main
  id="main-content"
  className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-950/40 custom-scrollbar"
  tabIndex={-1}
>
  {children}
</main>
```

**Critérios de aceitação:**
- [ ] Link "Pular para o conteúdo principal" invisível por padrão
- [ ] Visível ao pressionar Tab uma vez a partir do topo
- [ ] Clicar/Enter no link move o foco para o `<main>` com `id="main-content"`
- [ ] Botões do sidebar têm `aria-current="page"` no item ativo

---

### UX-06 — Estados Vazios com Ilustração e CTA

**Componente:** `components/dashboard/DashboardWidgets.tsx`
**Impacto:** Admins com dados zerados ou filtros sem resultado. Severidade **P1** — o estado vazio atual (`InvestmentsTable`, linha 430-432) exibe apenas texto sem orientar o próximo passo.

**Problema:**
Quando a tabela de investimentos está vazia, aparece somente `"Nenhum investimento encontrado"` em texto pequeno sem contexto, ícone ou ação sugerida.

**Proposta:**
Criar componente `<EmptyState>` reutilizável com ícone, mensagem contextual e CTA opcional.

**Código sugerido:**

```tsx
// Componente EmptyState — adicionar em DashboardWidgets.tsx

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center py-16 px-8 text-center" role="status" aria-label={title}>
    <div className="w-20 h-20 rounded-full bg-slate-700/50 flex items-center justify-center mb-6 text-slate-500">
      {icon}
    </div>
    <h4 className="text-white font-black text-lg mb-2">{title}</h4>
    <p className="text-slate-500 text-sm max-w-xs leading-relaxed mb-6">{description}</p>
    {action && (
      <button
        onClick={action.onClick}
        className="bg-teal-600 hover:bg-teal-500 text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
      >
        {action.label}
      </button>
    )}
  </div>
);

// Uso na InvestmentsTable (substituir linha 430-432):
{data.length === 0 && (
  <tr>
    <td colSpan={6}>
      <EmptyState
        icon={<Wallet size={36} />}
        title="Nenhum investimento"
        description="Nenhum contrato foi encontrado. Crie o primeiro contrato para começar a acompanhar os rendimentos."
      />
    </td>
  </tr>
)}

// Uso na InstallmentsTable (substituir linha 755-760):
{filteredData.length === 0 && (
  <tr>
    <td colSpan={6}>
      <EmptyState
        icon={<CalendarCheck size={36} />}
        title={filterMode === 'range' && (!rangeStart || !rangeEnd)
          ? 'Selecione o período'
          : 'Nenhum recebível'}
        description={filterMode === 'range' && (!rangeStart || !rangeEnd)
          ? 'Defina as datas de início e fim para visualizar os recebíveis.'
          : 'Não há parcelas para o período e filtro selecionados.'}
      />
    </td>
  </tr>
)}
```

**Critérios de aceitação:**
- [ ] `<EmptyState>` usado em `InvestmentsTable` e `InstallmentsTable`
- [ ] Ícone, título e descrição contextual visíveis
- [ ] Componente centralizado horizontalmente no espaço da tabela
- [ ] `role="status"` presente para acessibilidade

---

### UX-07 — Tabs do Dashboard com Scroll Horizontal no Mobile

**Componente:** `components/Dashboard.tsx`
**Impacto:** Usuários mobile admin. Severidade **P1** — em telas pequenas (< 400px), as 4 tabs ficam comprimidas ao ponto de ficarem ilegíveis ou cortadas.

**Problema:**
O container das tabs (linha 64) usa `flex gap-1` sem `overflow-x-auto`. Em mobile com 4 tabs, cada uma tem menos de 80px o que torna o texto truncado e os ícones sobrepostos.

**Proposta:**
Adicionar scroll horizontal com snap no container das tabs. Incluir indicador visual de que há mais conteúdo (fade gradient na borda direita).

**Código sugerido:**

```tsx
// Substituir o wrapper das tabs (linha 64 em Dashboard.tsx):

<div className="relative">
  {/* Gradient fade indicando scroll */}
  <div className="absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-slate-900 to-transparent z-10 pointer-events-none md:hidden" />

  <div
    className="flex gap-1 bg-slate-800/50 p-1 rounded-xl overflow-x-auto scrollbar-none scroll-smooth snap-x snap-mandatory"
    role="tablist"
    aria-label="Seções do dashboard"
  >
    {[
      { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard },
      { id: 'receivables', label: 'Recebíveis', icon: FileText },
      { id: 'investors', label: 'Investidores', icon: Users },
      { id: 'reports', label: 'Relatórios', icon: PieChart },
    ].map(tab => (
      <button
        key={tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        aria-controls={`tabpanel-${tab.id}`}
        onClick={() => setActiveTab(tab.id as any)}
        className={`shrink-0 snap-start px-3 md:px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
          activeTab === tab.id
            ? 'bg-teal-600 text-white shadow-lg'
            : 'text-slate-500 hover:text-white'
        }`}
      >
        <tab.icon size={14} />
        <span className="hidden sm:inline">{tab.label}</span>
        <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
      </button>
    ))}
  </div>
</div>

// Adicionar ao content panel:
<div
  id={`tabpanel-overview`}
  role="tabpanel"
  aria-labelledby="tab-overview"
  hidden={activeTab !== 'overview'}
>
  {/* conteúdo */}
</div>
```

**Critérios de aceitação:**
- [ ] Tabs com scroll horizontal em viewport < 640px
- [ ] Nenhuma tab fica cortada ou ilegível em 320px
- [ ] Gradient fade direito visível apenas em mobile indicando scroll
- [ ] Atributos `role="tab"`, `aria-selected`, `aria-controls` presentes
- [ ] Em desktop, comportamento inalterado

---

### UX-08 — Ações de Tabela com Tooltips e Teclado

**Componente:** `components/dashboard/DashboardWidgets.tsx`
**Impacto:** Administradores. Severidade **P1** — os botões de ação nas linhas da tabela (pagar, refinanciar, editar) ficam ocultos com `opacity-50` e só aparecem no hover (linha 736). Em mobile e para usuários de teclado, são inacessíveis.

**Problema:**
Linha 736: `opacity-50 group-hover:opacity-100`. Botões invisíveis ao padrão impedem que usuários mobile os encontrem sem hover. Botões sem `aria-label` legível (apenas `title`).

**Proposta:**
Tornar botões sempre visíveis em mobile. Adicionar `aria-label` descritivos. Adicionar tooltip acessível via CSS puro.

**Código sugerido:**

```tsx
// Substituir a célula de ações (linhas 735-751 em DashboardWidgets.tsx):

<td className="px-6 py-4 text-right">
  <div className="flex justify-end gap-2 opacity-100 md:opacity-50 md:group-hover:opacity-100 transition-opacity">
    {inst.status !== 'paid' && (
      <>
        <button
          onClick={() => handleAction('pay', inst)}
          className="relative p-1.5 bg-emerald-900/30 text-emerald-400 rounded hover:bg-emerald-600 hover:text-white transition-colors group/btn"
          aria-label={`Registrar pagamento da parcela ${inst.number} de ${inst.contract_name}`}
        >
          <DollarSign size={14} />
          <span className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-slate-900 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity border border-slate-700">
            Baixar Pagamento
          </span>
        </button>
        <button
          onClick={() => handleAction('refinance', inst)}
          className="relative p-1.5 bg-purple-900/30 text-purple-400 rounded hover:bg-purple-600 hover:text-white transition-colors group/btn"
          aria-label={`Refinanciar parcela ${inst.number} de ${inst.contract_name}`}
        >
          <RefreshCw size={14} />
          <span className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-slate-900 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity border border-slate-700">
            Refinanciar
          </span>
        </button>
      </>
    )}
    <button
      onClick={() => handleAction('edit', inst)}
      className="relative p-1.5 bg-sky-900/30 text-sky-400 rounded hover:bg-sky-600 hover:text-white transition-colors group/btn"
      aria-label={`Editar parcela ${inst.number} de ${inst.contract_name}`}
    >
      <Pencil size={14} />
      <span className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-slate-900 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity border border-slate-700">
        Editar
      </span>
    </button>
  </div>
</td>
```

**Critérios de aceitação:**
- [ ] Botões sempre visíveis em mobile (opacity-100 em < md)
- [ ] Tooltip aparece no hover em desktop
- [ ] Cada botão tem `aria-label` descritivo incluindo número da parcela e nome do contrato
- [ ] Botões são acessíveis por tabulação (nenhum `tabIndex={-1}` sem razão)

---

### UX-09 — Fluxo PIX com Instruções Passo a Passo

**Componente:** `components/PaymentModal.tsx`
**Impacto:** Devedores (principalmente os menos familiarizados com PIX). Severidade **P1** — muitos usuários não sabem que precisam abrir o app bancário e usar a câmera/colar o código.

**Problema:**
O modal exibe o QR Code e o código copia-e-cola sem nenhuma instrução de uso. Usuários que não conhecem PIX ficam perdidos.

**Proposta:**
Adicionar seção colapsável "Como pagar?" com 3 passos ilustrados, visível por padrão na primeira abertura do modal.

**Código sugerido:**

```tsx
// Adicionar no final do modal, antes do Footer (linha 191):

const [showInstructions, setShowInstructions] = useState(false);

// JSX:
<div className="w-full border-t border-slate-700/50 pt-4">
  <button
    onClick={() => setShowInstructions(prev => !prev)}
    className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-white transition-colors font-bold uppercase tracking-widest"
    aria-expanded={showInstructions}
  >
    <span className="flex items-center gap-2">
      <Info size={14} /> Como pagar com PIX?
    </span>
    <ChevronDown
      size={16}
      className={`transition-transform duration-200 ${showInstructions ? 'rotate-180' : ''}`}
    />
  </button>

  {showInstructions && (
    <div className="mt-4 space-y-3 animate-fade-in-down" role="list">
      {[
        { step: 1, label: 'Abra seu banco', desc: 'Acesse o app do seu banco ou carteira digital.' },
        { step: 2, label: 'Vá em Pagar com PIX', desc: 'Selecione a opção de pagar via QR Code ou Copia e Cola.' },
        { step: 3, label: 'Confirme o pagamento', desc: 'Escaneie o QR ou cole o código e confirme o valor exibido.' },
      ].map(({ step, label, desc }) => (
        <div key={step} className="flex items-start gap-3" role="listitem">
          <div className="w-6 h-6 rounded-full bg-teal-900/50 border border-teal-700 flex items-center justify-center shrink-0 text-teal-400 font-black text-[10px]">
            {step}
          </div>
          <div>
            <p className="text-white font-bold text-xs">{label}</p>
            <p className="text-slate-500 text-[10px] leading-relaxed">{desc}</p>
          </div>
        </div>
      ))}
    </div>
  )}
</div>
```

**Critérios de aceitação:**
- [ ] Seção "Como pagar?" está colapsada por padrão
- [ ] Expande ao clicar com animação suave
- [ ] 3 passos com número, título e descrição
- [ ] `aria-expanded` atualizado dinamicamente no botão
- [ ] Não interfere com o countdown timer (UX-02)

---

### UX-10 — Sistema de Toast Notifications Centralizado

**Componente:** `App.tsx` (global)
**Impacto:** Todos os usuários. Severidade **P1** — atualmente erros de operações (salvar configurações, criar convite, editar parcela) são exibidos de formas inconsistentes: dentro do modal, como texto vermelho ou simplesmente silenciados.

**Problema:**
`AdminSettings.tsx` usa estado local `success`/`fieldError`. `AdminUsers.tsx` usa `errorMessage`. Não há padrão unificado. Mensagens de sucesso somem rapidamente sem o usuário perceber.

**Proposta:**
Criar um `ToastContext` que fornece `showToast(message, type)` para qualquer componente. Renderizar toasts no canto superior direito com auto-dismiss de 4 segundos.

**Código sugerido:**

```tsx
// Criar services/toast.tsx (novo arquivo)

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export const useToast = () => useContext(ToastContext);

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: 'bg-emerald-900/90 border-emerald-600 text-emerald-200',
  error: 'bg-red-900/90 border-red-600 text-red-200',
  info: 'bg-slate-800/90 border-slate-600 text-slate-200',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed top-6 right-6 z-[200] flex flex-col gap-3 max-w-sm w-full pointer-events-none"
      >
        {toasts.map(toast => {
          const Icon = ICONS[toast.type];
          return (
            <div
              key={toast.id}
              className={`flex items-start gap-3 p-4 rounded-2xl border shadow-2xl backdrop-blur-md pointer-events-auto animate-fade-in-down ${COLORS[toast.type]}`}
              role="alert"
            >
              <Icon size={18} className="shrink-0 mt-0.5" />
              <p className="text-sm font-medium flex-1">{toast.message}</p>
              <button
                onClick={() => dismiss(toast.id)}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                aria-label="Fechar notificação"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

// Em App.tsx, envolver o return com:
import { ToastProvider } from './services/toast';

// Dentro do JSX raiz:
<ToastProvider>
  {/* ... conteúdo atual ... */}
</ToastProvider>

// Uso em qualquer componente:
const { showToast } = useToast();
showToast('Configurações salvas com sucesso!', 'success');
showToast('Erro ao processar pagamento.', 'error');
```

**Critérios de aceitação:**
- [ ] `ToastProvider` envolve a árvore de componentes em `App.tsx`
- [ ] `useToast()` disponível em qualquer componente
- [ ] Toasts aparecem no canto superior direito
- [ ] Auto-dismiss em 4 segundos com botão de fechar manual
- [ ] Tipos: success (verde), error (vermelho), info (cinza)
- [ ] `aria-live="polite"` presente para leitores de tela
- [ ] `AdminSettings` migrado para usar `showToast` ao salvar

---

### UX-11 — Skeleton Loading em Cards de Usuários

**Componente:** `components/AdminUsers.tsx`
**Impacto:** Administradores. Severidade **P1** — a lista de usuários exibe apenas um CreditCard girante (linha 40-47 equivalente) enquanto carrega. Cards aparecem todos de uma vez sem transição.

**Problema:**
Ao carregar a lista de usuários, a tela fica vazia por 1-3 segundos dependendo da conexão. Não há skeleton que preserve o layout.

**Proposta:**
Adicionar skeleton de 6 cards com o mesmo formato dos cards reais (avatar circular, 2 linhas de texto, 2 badges).

**Código sugerido:**

```tsx
// Adicionar em AdminUsers.tsx antes do return principal:

const UserCardSkeleton: React.FC = () => (
  <div className="bg-slate-800 rounded-[2rem] border border-slate-700 p-6 space-y-4 animate-pulse">
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-slate-700" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-slate-700 rounded w-3/4" />
        <div className="h-3 bg-slate-700/60 rounded w-1/2" />
      </div>
    </div>
    <div className="flex gap-2">
      <div className="h-6 w-20 bg-slate-700/60 rounded-full" />
      <div className="h-6 w-16 bg-slate-700/60 rounded-full" />
    </div>
    <div className="flex justify-end gap-2 pt-2 border-t border-slate-700/50">
      <div className="h-8 w-24 bg-slate-700/60 rounded-xl" />
      <div className="h-8 w-8 bg-slate-700/60 rounded-xl" />
    </div>
  </div>
);

// Substituir o bloco de loading atual por:
if (loading) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando usuários">
      {/* Header skeleton */}
      <div className="flex justify-between items-center">
        <div className="h-8 w-48 bg-slate-700/50 rounded animate-pulse" />
        <div className="h-10 w-36 bg-slate-700/50 rounded-xl animate-pulse" />
      </div>
      {/* Search skeleton */}
      <div className="h-12 bg-slate-800 rounded-2xl animate-pulse" />
      {/* Cards grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => <UserCardSkeleton key={i} />)}
      </div>
    </div>
  );
}
```

**Critérios de aceitação:**
- [ ] 6 cards skeleton aparecem durante o loading
- [ ] Layout do skeleton reflete o card real (avatar, nome, badges, ações)
- [ ] `aria-busy="true"` no container
- [ ] Transição de skeleton para conteúdo real sem flash

---

### UX-12 — Animação de Accordion com Altura CSS

**Componente:** `components/DebtorDashboard.tsx`
**Impacto:** Devedores. Severidade **P1** — o accordion de contratos expande/recolhe abruptamente sem transição. A classe `animate-fade-in-down` (linha 188) faz o conteúdo aparecer, mas não anima a altura, causando um "pulo" brusco no layout.

**Problema:**
Linha 187: `{isOpen && <div ...animate-fade-in-down>}`. Condicional React remove/insere o DOM sem animar a altura. Em dispositivos móveis lentos, o efeito é visivelmente abrupto.

**Proposta:**
Usar `max-height` com transição CSS para animar abertura/fechamento suavemente.

**Código sugerido:**

```tsx
// Substituir o bloco condicional do accordion (linha 187-242):

{/* BODY (Installments List) — sempre no DOM, animado via max-height */}
<div
  className="overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out"
  style={{
    maxHeight: isOpen ? '2000px' : '0px',
    opacity: isOpen ? 1 : 0,
  }}
  aria-hidden={!isOpen}
  id={`contract-${contract.id}-installments`}
>
  <div className="border-t border-slate-700/50 bg-slate-900/30 p-4 md:p-6">
    {/* ... conteúdo da tabela de parcelas inalterado ... */}
  </div>
</div>

// No botão do header, adicionar aria-expanded e aria-controls:
<div
  onClick={() => toggleAccordion(contract.id)}
  role="button"
  tabIndex={0}
  onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? toggleAccordion(contract.id) : null}
  aria-expanded={isOpen}
  aria-controls={`contract-${contract.id}-installments`}
  className="p-6 md:p-8 cursor-pointer hover:bg-slate-700/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-6"
>
  {/* ... conteúdo do header inalterado ... */}
</div>
```

**Critérios de aceitação:**
- [ ] Accordion expande com animação suave (~300ms)
- [ ] Accordion recolhe com animação suave (~300ms)
- [ ] Sem "pulo" de layout durante animação
- [ ] `aria-expanded` e `aria-controls` presentes no botão
- [ ] Acessível via teclado (Enter/Space)

---

### UX-13 — Busca e Filtro na Lista de Investimentos do Investidor

**Componente:** `components/InvestorDashboard.tsx`
**Impacto:** Investidores com múltiplos contratos. Severidade **P1** — a lista de investimentos não tem busca nem filtro (lidos dos hooks na linha 25). Investidores com 10+ contratos precisam rolar para encontrar um específico.

**Problema:**
`InvestorDashboard` renderiza todos os investimentos sem qualquer mecanismo de filtro. Não há campo de busca por nome do tomador ou ativo.

**Proposta:**
Adicionar campo de busca compacto acima da lista de investimentos. Filtrar por nome do ativo ou nome do tomador em tempo real.

**Código sugerido:**

```tsx
// Adicionar em InvestorDashboard.tsx, após os imports:
import { useState, useMemo } from 'react';

// Dentro do componente, antes do return:
const [investmentSearch, setInvestmentSearch] = useState('');

const filteredInvestments = useMemo(() => {
  if (!investmentSearch.trim()) return investments;
  const term = investmentSearch.toLowerCase();
  return investments.filter(inv =>
    inv.asset_name?.toLowerCase().includes(term) ||
    inv.payer?.full_name?.toLowerCase().includes(term)
  );
}, [investments, investmentSearch]);

// JSX — adicionar antes da lista de investimentos:
{investments.length > 3 && (
  <div className="relative">
    <Search className="absolute left-4 top-3.5 text-slate-500" size={16} />
    <input
      type="text"
      value={investmentSearch}
      onChange={e => setInvestmentSearch(e.target.value)}
      placeholder="Buscar por ativo ou tomador..."
      className="w-full bg-slate-800 border border-slate-700 rounded-2xl pl-11 pr-4 py-3 text-sm text-white focus:border-teal-500 outline-none transition-colors placeholder:text-slate-600"
      aria-label="Buscar investimentos"
    />
    {investmentSearch && (
      <button
        onClick={() => setInvestmentSearch('')}
        className="absolute right-4 top-3.5 text-slate-500 hover:text-white transition-colors"
        aria-label="Limpar busca"
      >
        <X size={16} />
      </button>
    )}
  </div>
)}

{/* Usar filteredInvestments no lugar de investments na renderização */}
{filteredInvestments.length === 0 && investmentSearch && (
  <EmptyState
    icon={<Search size={32} />}
    title="Nenhum resultado"
    description={`Nenhum investimento encontrado para "${investmentSearch}".`}
    action={{ label: 'Limpar busca', onClick: () => setInvestmentSearch('') }}
  />
)}
```

**Critérios de aceitação:**
- [ ] Campo de busca aparece apenas quando há mais de 3 investimentos
- [ ] Filtra em tempo real por nome do ativo e nome do tomador
- [ ] Botão de limpar (X) aparece quando há texto
- [ ] Estado vazio com botão de limpar ao não encontrar resultado
- [ ] Campo acessível com `aria-label`

---

### UX-14 — Toggle Mostrar/Ocultar Senha no Login

**Componente:** `components/Login.tsx`
**Impacto:** Todos os usuários na autenticação. Severidade **P2** — não há como verificar a senha digitada antes de submeter.

**Problema:**
O campo de senha (linha 187) é fixo como `type="password"`. Em mobile, onde erros de digitação são comuns, o usuário não consegue verificar o que digitou.

**Proposta:**
Adicionar botão de olho (Eye/EyeOff) dentro do campo de senha para alternar visibilidade.

**Código sugerido:**

```tsx
// Adicionar import no topo de Login.tsx:
import { Eye, EyeOff } from 'lucide-react';

// Adicionar estado:
const [showPassword, setShowPassword] = useState(false);

// Substituir o input de senha (linha 187):
<div className="relative">
  <input
    required
    type={showPassword ? 'text' : 'password'}
    value={password}
    onChange={(e) => setPassword(e.target.value)}
    minLength={6}
    className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 pr-12 text-sm text-white focus:border-teal-500 outline-none transition-colors"
    placeholder="Senha de Acesso"
    autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
  />
  <button
    type="button"
    onClick={() => setShowPassword(prev => !prev)}
    className="absolute right-4 top-3.5 text-slate-500 hover:text-slate-300 transition-colors"
    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
    tabIndex={-1}
  >
    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
  </button>
</div>
```

**Critérios de aceitação:**
- [ ] Ícone Eye/EyeOff presente dentro do campo de senha
- [ ] Clique alterna entre `type="password"` e `type="text"`
- [ ] `aria-label` muda conforme estado
- [ ] `tabIndex={-1}` para não interromper o fluxo de tabulação do formulário
- [ ] `autoComplete` correto: `current-password` no login, `new-password` no cadastro

---

### UX-15 — Preview de Logo em Tempo Real

**Componente:** `components/AdminSettings.tsx`
**Impacto:** Administradores ao configurar o tenant. Severidade **P2** — ao colar uma URL de logo, o admin não consegue verificar se a imagem é válida sem salvar e recarregar.

**Problema:**
O campo `logoUrl` (linha 15-16) é um `<input type="text">` simples. Não há preview. O admin pode salvar uma URL incorreta sem perceber.

**Proposta:**
Adicionar mini-preview ao lado do campo com fallback e indicador de erro de carregamento.

**Código sugerido:**

```tsx
// Adicionar estado:
const [logoError, setLogoError] = useState(false);

// Ao mudar logoUrl, resetar erro:
const handleLogoUrlChange = (url: string) => {
  setLogoUrl(url);
  setLogoError(false);
};

// JSX — substituir o campo de logoUrl:
<div className="space-y-2">
  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
    URL do Logo
  </label>
  <div className="flex items-center gap-3">
    {/* Preview */}
    <div className="w-12 h-12 rounded-xl border border-slate-700 bg-slate-900 flex items-center justify-center shrink-0 overflow-hidden">
      {logoUrl && !logoError ? (
        <img
          src={logoUrl}
          alt="Preview do logo"
          className="w-full h-full object-cover"
          onError={() => setLogoError(true)}
        />
      ) : (
        <ImageIcon size={20} className={logoError ? 'text-red-400' : 'text-slate-600'} />
      )}
    </div>
    <div className="flex-1">
      <input
        type="url"
        value={logoUrl}
        onChange={(e) => handleLogoUrlChange(e.target.value)}
        className={`w-full bg-slate-900/50 border rounded-xl px-4 py-3 text-sm text-white outline-none transition-colors ${
          logoError ? 'border-red-500 focus:border-red-400' : 'border-slate-800 focus:border-teal-500'
        }`}
        placeholder="https://exemplo.com/logo.png"
      />
      {logoError && (
        <p className="text-red-400 text-[10px] mt-1 flex items-center gap-1">
          <AlertTriangle size={10} /> URL inválida ou imagem inacessível
        </p>
      )}
    </div>
  </div>
</div>
```

**Critérios de aceitação:**
- [ ] Preview 48x48px ao lado do campo de URL
- [ ] Imagem aparece em tempo real ao colar URL válida
- [ ] Ícone de erro vermelho quando URL falha ao carregar
- [ ] Mensagem de erro inline abaixo do campo
- [ ] Estado de erro reseta ao alterar a URL

---

### UX-16 — Tooltips Ricos nos Gráficos Recharts

**Componente:** `components/dashboard/DashboardWidgets.tsx`
**Impacto:** Administradores. Severidade **P2** — os tooltips padrão do Recharts exibem valores em BRL mas sem contexto percentual ou comparativo.

**Problema:**
Os `<Tooltip>` em `OverviewCharts` (linhas 325-330 e 373-375) usam o formatter padrão. Não mostram percentual do total nem variação.

**Proposta:**
Criar `CustomTooltip` para o gráfico de "Saúde da Carteira" que exibe valor, percentual do total e rótulo descritivo.

**Código sugerido:**

```tsx
// Adicionar em DashboardWidgets.tsx, antes de OverviewCharts:

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; fill: string }>;
  total?: number;
}

const PortfolioTooltip: React.FC<CustomTooltipProps> = ({ active, payload, total = 1 }) => {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-slate-950 border border-slate-700 rounded-2xl p-4 shadow-2xl min-w-[200px]">
      {payload.map((entry, i) => {
        const pct = ((entry.value / total) * 100).toFixed(1);
        return (
          <div key={i} className="flex items-center justify-between gap-4 mb-2 last:mb-0">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.fill }} />
              <span className="text-slate-400 text-xs">{entry.name}</span>
            </div>
            <div className="text-right">
              <p className="text-white font-black text-xs">{formatCurrency(entry.value)}</p>
              <p className="text-slate-500 text-[9px]">{pct}% do total</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// No BarChart de portfolioData (linha 315-337):
const portfolioTotal = kpis.totalPrincipalRepaid + kpis.activeStreetMoney + kpis.totalProfitReceived;

<Tooltip
  cursor={{ fill: '#1e293b' }}
  content={<PortfolioTooltip total={portfolioTotal} />}
/>
```

**Critérios de aceitação:**
- [ ] Tooltip customizado no gráfico "Saúde da Carteira"
- [ ] Exibe nome da série, valor em BRL e percentual do total
- [ ] Cor da bolinha corresponde à cor da barra
- [ ] Estilo consistente com o design system (bg-slate-950, rounded-2xl)

---

### UX-17 — Role do Usuário no Header Mobile

**Componente:** `App.tsx`
**Impacto:** Todos os usuários em mobile. Severidade **P2** — no mobile, o header exibe apenas o ícone de usuário (linha 154) sem nome ou role. O usuário não sabe com qual conta está logado.

**Problema:**
Linha 154-156: o header mobile mostra apenas `<User size={16} />`. Em contraste, o header desktop (linhas 142-150) exibe nome e role. Inconsistência relevante para usuários que têm múltiplos perfis.

**Proposta:**
Adicionar nome abreviado e badge de role no header mobile, aproveitando o espaço disponível à direita do botão hambúrguer.

**Código sugerido:**

```tsx
// Substituir o bloco mobile do header (linhas 153-156):

<div className="md:hidden flex items-center gap-2">
  <div className="text-right">
    <p className="text-xs font-bold text-white leading-none">
      {profile?.full_name?.split(' ')[0] || 'Usuário'}
    </p>
    <p className="text-[9px] text-teal-400 uppercase tracking-widest font-black">
      {userRole === 'admin' ? 'Admin' : userRole || ''}
    </p>
  </div>
  <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-teal-500">
    <User size={16} />
  </div>
</div>
```

**Critérios de aceitação:**
- [ ] Primeiro nome do usuário visível no header mobile
- [ ] Role exibida em teal abaixo do nome
- [ ] Não interfere com o botão hambúrguer à esquerda
- [ ] Texto truncado se nome for muito longo (`truncate max-w-[80px]`)

---

### UX-18 — Focus Ring Acessível e Consistente

**Componente:** Global (`App.tsx`, todos os componentes)
**Impacto:** Usuários de teclado e leitores de tela. Severidade **P2** — o `outline-none` aplicado em vários inputs remove completamente o indicador de foco nativo do browser, tornando a navegação por teclado impossível de rastrear visualmente.

**Problema:**
Ocorrências de `outline-none` sem substituição:
- `Login.tsx` linhas 174, 178, 183, 186, 187
- `DashboardWidgets.tsx` linhas 264, 596, 598, 615
- Todos os inputs têm `outline-none` sem `focus-visible:ring`

**Proposta:**
Adicionar classe `focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900` em todos os elementos interativos. Usar `focus-visible` (não `focus`) para não mostrar o anel em cliques de mouse.

**Código sugerido:**

```tsx
// Criar uma classe CSS utilitária global em index.css ou equivalente:

/* Adicionar em index.css */
.focus-ring {
  @apply outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900;
}

/* Ou via Tailwind config — adicionar plugin em tailwind.config.js:
theme: {
  extend: {
    // ...
  }
}
plugins: [
  plugin(({ addUtilities }) => {
    addUtilities({
      '.focus-ring': {
        outline: 'none',
        '&:focus-visible': {
          ring: '2px',
          ringColor: '#0d9488',
          ringOffset: '2px',
          ringOffsetColor: '#0f172a',
        }
      }
    })
  })
]
*/

// Aplicar nos inputs de Login.tsx — substituir outline-none por focus-ring:
<input
  className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white transition-colors focus-ring focus:border-teal-500"
  // ...
/>

// Aplicar em todos os botões de navegação da sidebar (App.tsx):
<button
  className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 focus-ring ${
    activeView === AppView.DASHBOARD ? '...' : '...'
  }`}
>
```

**Critérios de aceitação:**
- [ ] Todos os `<input>` têm `focus-visible:ring-2 focus-visible:ring-teal-500`
- [ ] Todos os `<button>` de navegação têm anel de foco visível
- [ ] Anel aparece apenas na navegação por teclado (não ao clicar com mouse)
- [ ] Cor do anel: `teal-500` (consistente com o accent color da plataforma)
- [ ] `ring-offset-color` correto para cada contexto de fundo (slate-900 ou slate-800)

---

## Resumo de Prioridades de Implementação

### Sprint 1 — Crítico (P0)
1. **UX-01** Skeleton loading do dashboard — maior impacto percebido
2. **UX-02** Countdown timer no PIX — previne erros reais de pagamento
3. **UX-03** Indicador de força de senha — segurança crítica
4. **UX-04** Validação inline de formulário de contratos — reduz erros de dados

### Sprint 2 — Alto Impacto (P1)
5. **UX-10** Toast notifications centralizadas — infraestrutura para os demais
6. **UX-06** Estados vazios melhorados — qualidade geral
7. **UX-05** Skip-to-content — acessibilidade estrutural
8. **UX-07** Tabs com scroll horizontal — usabilidade mobile
9. **UX-11** Skeleton de usuários — consistência de loading
10. **UX-12** Animação de accordion — fluidez no DebtorDashboard
11. **UX-08** Ações de tabela acessíveis — acessibilidade em tabelas
12. **UX-09** Instruções PIX — redução de chamadas ao suporte
13. **UX-13** Busca em investimentos — produtividade do investidor

### Sprint 3 — Refinamento (P2)
14. **UX-18** Focus ring consistente — acessibilidade global
15. **UX-14** Toggle mostrar senha — conforto no login
16. **UX-17** Role no header mobile — identidade contextual
17. **UX-15** Preview de logo — feedback imediato
18. **UX-16** Tooltips ricos nos gráficos — profundidade analítica

---

## Notas Técnicas para @dev

### Dependências Existentes
Nenhuma dependência nova é necessária para UX-01 a UX-18. Todas as soluções usam:
- Tailwind CSS (já presente)
- Lucide React (já presente, todos os ícones mencionados disponíveis)
- React hooks nativos (`useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`)

### Animações
As classes `animate-fade-in-down` e `animate-fade-in` já estão em uso no projeto. Para UX-12 (accordion), a solução usa transição CSS via `transition-[max-height,opacity]` que funciona com Tailwind sem configuração adicional.

### Acessibilidade — WCAG 2.1 AA
As propostas UX-05, UX-07, UX-08, UX-12, UX-18 trazem a plataforma para conformidade com WCAG 2.1 nível AA nos fluxos críticos de pagamento e navegação. O atributo `aria-live="polite"` em UX-02 e UX-10 é especialmente importante para usuários de leitores de tela que não conseguem perceber mudanças visuais.

### Testes de Aceitação Recomendados
- Navegar toda a aplicação usando apenas Tab/Shift+Tab/Enter/Space
- Testar com viewport 375px (iPhone SE) e 414px (iPhone Plus)
- Verificar contraste de texto com DevTools > Accessibility > Color Contrast

---

*Documento gerado por Uma — UX/UI Design Expert Agent — Synkra AIOS*
*Revisão técnica: @dev (Dex) — Implementação: Sprint planejado com @sm*
