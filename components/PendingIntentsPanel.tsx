import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  ChevronDown,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  markOfflineIntentApplied,
  OFFLINE_FINANCIAL_CHANGE_EVENT,
  type OfflinePaymentIntent,
} from '../services/offlineQueue';
import { clearAllCache } from '../services/cache';
import { getSupabase, parseSupabaseError } from '../services/supabase';

interface PendingIntentsPanelProps {
  intents: OfflinePaymentIntent[];
  syncing: boolean;
  syncError?: string | null;
  onSync: () => Promise<void>;
  onOpenContract: (investmentId: number, companyId: string | null) => void;
}

type AvulsoDestination = 'principal_reduction' | 'penalty_payment' | 'general_credit';

const money = (amount: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);

const fieldDate = (paidAt: string) => {
  const ymd = paidAt.slice(0, 10);
  const [year, month, day] = ymd.split('-');
  return `${day}/${month}/${year}`;
};

const PendingIntentsPanel: React.FC<PendingIntentsPanelProps> = ({
  intents,
  syncing,
  syncError,
  onSync,
  onOpenContract,
}) => {
  const online = useOnlineStatus();
  const pending = useMemo(() => intents.filter((intent) => intent.status === 'pending'), [intents]);
  const rejected = useMemo(() => intents.filter((intent) => intent.status === 'rejected'), [intents]);
  const [open, setOpen] = useState(false);
  const [avulsoId, setAvulsoId] = useState<string | null>(null);
  const [destination, setDestination] = useState<AvulsoDestination>('general_credit');
  const [discardId, setDiscardId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (rejected.length > 0) setOpen(true);
  }, [rejected.length]);

  if (intents.length === 0 && !syncError) return null;

  const resolveAsAvulso = async (intent: OfflinePaymentIntent) => {
    if (!online) {
      setActionError('Conecte-se para lançar este recebimento como pagamento avulso.');
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setActionError('Conexão com o servidor indisponível.');
      return;
    }

    setWorkingId(intent.id);
    setActionError(null);
    try {
      const { error } = await supabase.rpc('resolve_offline_intent_as_avulso', {
        p_intent_id: intent.id,
        p_destination: destination,
        p_notes: `Recebimento offline originalmente associado à parcela #${intent.installmentNumber}`,
      });
      if (error) throw error;
      markOfflineIntentApplied(intent.id);
      clearAllCache();
      window.dispatchEvent(new Event(OFFLINE_FINANCIAL_CHANGE_EVENT));
      setAvulsoId(null);
    } catch (error) {
      setActionError(parseSupabaseError(error));
    } finally {
      setWorkingId(null);
    }
  };

  const discard = async (intent: OfflinePaymentIntent) => {
    if (!online) {
      setActionError('Conecte-se para confirmar o descarte desta intenção.');
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setActionError('Conexão com o servidor indisponível.');
      return;
    }

    setWorkingId(intent.id);
    setActionError(null);
    try {
      const { error } = await supabase.rpc('discard_offline_payment_intent', {
        p_intent_id: intent.id,
      });
      if (error) throw error;
      markOfflineIntentApplied(intent.id);
      setDiscardId(null);
    } catch (error) {
      setActionError(parseSupabaseError(error));
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section
      data-testid="pending-intents-panel"
      className={`mb-4 overflow-hidden rounded-2xl border ${
        rejected.length > 0
          ? 'border-[rgba(239,68,68,0.26)] bg-[rgba(239,68,68,0.08)]'
          : 'border-[rgba(240,180,41,0.22)] bg-[rgba(240,180,41,0.08)]'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        {syncing ? (
          <Loader2 size={17} className="shrink-0 animate-spin text-[color:var(--accent-brass)]" />
        ) : rejected.length > 0 ? (
          <AlertTriangle size={17} className="shrink-0 text-[color:var(--accent-negative)]" />
        ) : (
          <UploadCloud size={17} className="shrink-0 text-[color:var(--accent-brass)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[color:var(--text-primary)]">
            {rejected.length > 0
              ? `${rejected.length} baixa${rejected.length === 1 ? '' : 's'} precisa${rejected.length === 1 ? '' : 'm'} de decisão`
              : syncing
                ? 'Enviando baixas salvas…'
                : `${pending.length} baixa${pending.length === 1 ? '' : 's'} aguardando envio`}
          </p>
          <p className="text-xs text-[color:var(--text-muted)]">
            {pending.length > 0 && `${pending.length} pendente${pending.length === 1 ? '' : 's'}`}
            {pending.length > 0 && rejected.length > 0 && ' · '}
            {rejected.length > 0 && `${rejected.length} rejeitada${rejected.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <ChevronDown size={17} className={`shrink-0 text-[color:var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-white/10 px-4 py-4">
          {(syncError || actionError) && (
            <div role="alert" className="rounded-xl border border-[rgba(239,68,68,0.24)] bg-[rgba(239,68,68,0.10)] px-3 py-2 text-xs text-[color:var(--accent-negative)]">
              {actionError || syncError}
            </div>
          )}

          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.map((intent) => (
                <div key={intent.id} className="flex items-center justify-between gap-3 rounded-xl bg-black/10 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-[color:var(--text-primary)]">
                      {intent.debtorName} · parcela #{intent.installmentNumber}
                    </p>
                    <p className="text-xs text-[color:var(--text-muted)]">{money(intent.amount)} · {fieldDate(intent.paidAt)}</p>
                  </div>
                  <span className="shrink-0 text-[0.65rem] font-bold uppercase tracking-wide text-[color:var(--accent-brass)]">
                    aguardando
                  </span>
                </div>
              ))}
              <button
                type="button"
                onClick={() => void onSync()}
                disabled={!online || syncing}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-bold text-[color:var(--text-primary)] disabled:opacity-45"
              >
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {online ? 'Tentar enviar agora' : 'Envio disponível quando a rede voltar'}
              </button>
            </div>
          )}

          {rejected.map((intent) => (
            <article key={intent.id} className="rounded-xl border border-[rgba(239,68,68,0.20)] bg-[color:var(--bg-elevated)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[color:var(--text-primary)]">{intent.debtorName}</p>
                  <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
                    {intent.contractName} · parcela #{intent.installmentNumber} · {money(intent.amount)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[rgba(239,68,68,0.12)] px-2 py-1 text-[0.65rem] font-bold uppercase text-[color:var(--accent-negative)]">
                  recusada
                </span>
              </div>
              <p className="mt-3 rounded-lg bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs leading-relaxed text-[color:var(--accent-negative)]">
                {intent.errorMessage || 'O servidor recusou esta baixa.'}
              </p>

              {avulsoId === intent.id && (
                <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-black/10 p-3">
                  <label className="block text-xs font-bold text-[color:var(--text-primary)]" htmlFor={`avulso-${intent.id}`}>
                    Destino do pagamento avulso
                  </label>
                  <select
                    id={`avulso-${intent.id}`}
                    value={destination}
                    onChange={(event) => setDestination(event.target.value as AvulsoDestination)}
                    className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-soft)] px-3 py-2 text-xs text-[color:var(--text-primary)]"
                  >
                    <option value="general_credit">Crédito geral nas parcelas</option>
                    <option value="penalty_payment">Quitar multas e encargos</option>
                    <option value="principal_reduction">Reduzir principal (Bullet)</option>
                  </select>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setAvulsoId(null)} className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-[color:var(--text-muted)]">
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void resolveAsAvulso(intent)}
                      disabled={workingId === intent.id}
                      className="flex flex-[2] items-center justify-center gap-2 rounded-lg bg-[rgba(52,211,153,0.12)] px-3 py-2 text-xs font-bold text-[color:var(--accent-positive)] disabled:opacity-50"
                    >
                      {workingId === intent.id ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />}
                      Confirmar avulso
                    </button>
                  </div>
                </div>
              )}

              {discardId === intent.id && (
                <div className="mt-3 rounded-lg border border-[rgba(239,68,68,0.20)] bg-[rgba(239,68,68,0.06)] p-3">
                  <p className="text-xs leading-relaxed text-[color:var(--text-primary)]">
                    Confirme somente se este dinheiro já foi resolvido fora desta fila ou se o registro foi feito por engano.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => setDiscardId(null)} className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-[color:var(--text-muted)]">Voltar</button>
                    <button
                      type="button"
                      onClick={() => void discard(intent)}
                      disabled={workingId === intent.id}
                      className="flex flex-[2] items-center justify-center gap-2 rounded-lg bg-[rgba(239,68,68,0.12)] px-3 py-2 text-xs font-bold text-[color:var(--accent-negative)] disabled:opacity-50"
                    >
                      {workingId === intent.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      Confirmar descarte
                    </button>
                  </div>
                </div>
              )}

              {avulsoId !== intent.id && discardId !== intent.id && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => { setDestination('general_credit'); setDiscardId(null); setAvulsoId(intent.id); setActionError(null); }}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-[rgba(52,211,153,0.10)] px-3 py-2.5 text-xs font-bold text-[color:var(--accent-positive)]"
                  >
                    <Banknote size={13} /> Lançar avulso
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenContract(intent.investmentId, intent.companyId)}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-bold text-[color:var(--text-primary)]"
                  >
                    <ExternalLink size={13} /> Abrir contrato
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAvulsoId(null); setDiscardId(intent.id); setActionError(null); }}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-[rgba(239,68,68,0.08)] px-3 py-2.5 text-xs font-bold text-[color:var(--accent-negative)]"
                  >
                    <Trash2 size={13} /> Descartar
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

export default PendingIntentsPanel;
