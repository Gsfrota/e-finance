import React, { useEffect, useRef, useState } from 'react';
import { Lock, Fingerprint, ShieldCheck, Delete, AlertCircle } from 'lucide-react';
import {
  isPinEnabled, getPinLength, setPin, verifyPin, disablePin,
  recordFailedAttempt, resetAttempts, getFailedAttempts, isValidPinFormat,
  MAX_PIN_ATTEMPTS,
} from '../services/appLock';
import {
  isBiometricAvailable, isBiometricEnabled, enableBiometric, disableBiometric, unlockWithBiometric,
} from '../services/biometric';
import { useCompanyContext } from '../services/companyScope';

// Re-trava após este tempo em segundo plano. Em campo o app fica aberto o dia
// todo; só re-pede o PIN se o aparelho ficou guardado por um tempo.
const RELOCK_AFTER_MS = 5 * 60 * 1000;

// ───────────────────────── Tela de bloqueio ─────────────────────────────────
const LockScreen: React.FC<{ onUnlock: () => void; onForceLogin: () => void }> = ({ onUnlock, onForceLogin }) => {
  const [pin, setPinInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioOffered, setBioOffered] = useState(false);
  const pinLen = getPinLength() ?? 4;
  const lockedOut = getFailedAttempts() >= MAX_PIN_ATTEMPTS;

  useEffect(() => {
    let alive = true;
    if (isBiometricEnabled()) {
      isBiometricAvailable().then((ok) => { if (alive && ok) setBioOffered(true); });
    }
    return () => { alive = false; };
  }, []);

  const submit = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await verifyPin(value);
    if (ok) {
      resetAttempts();
      onUnlock();
      return;
    }
    const attempts = recordFailedAttempt();
    setPinInput('');
    if (attempts >= MAX_PIN_ATTEMPTS) {
      setError('Muitas tentativas. Entre com sua senha para continuar.');
    } else {
      setError(`PIN incorreto. ${MAX_PIN_ATTEMPTS - attempts} tentativa(s) restante(s).`);
    }
    setBusy(false);
  };

  const press = (d: string) => {
    if (busy || lockedOut) return;
    setError(null);
    const next = (pin + d).slice(0, pinLen);
    setPinInput(next);
    if (next.length === pinLen) void submit(next);
  };

  const tryBiometric = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await unlockWithBiometric();
    setBusy(false);
    if (ok) { resetAttempts(); onUnlock(); }
    else setError('Não foi possível confirmar a biometria. Use o PIN.');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-[color:var(--text-primary)]">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.2)]">
        <Lock size={28} />
      </div>
      <h1 className="mt-5 type-title text-[color:var(--text-primary)]">App bloqueado</h1>
      <p className="mt-1 type-caption text-[color:var(--text-muted)]">Digite seu PIN para continuar</p>

      {/* indicadores */}
      <div className="mt-6 flex items-center gap-3">
        {Array.from({ length: pinLen }).map((_, i) => (
          <span key={i} className={`h-3.5 w-3.5 rounded-full transition-colors ${i < pin.length ? 'bg-[color:var(--accent-brass)]' : 'bg-white/15'}`} />
        ))}
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 text-[color:var(--accent-danger)]">
          <AlertCircle size={15} />
          <span className="type-caption">{error}</span>
        </div>
      )}

      {!lockedOut && (
        <div className="mt-7 grid grid-cols-3 gap-3">
          {['1','2','3','4','5','6','7','8','9'].map((d) => (
            <button key={d} onClick={() => press(d)} disabled={busy}
              className="h-16 w-16 rounded-full bg-white/[0.04] text-2xl font-semibold ring-1 ring-white/10 transition-colors hover:bg-white/[0.08] active:bg-white/[0.12] disabled:opacity-40">
              {d}
            </button>
          ))}
          <div />
          <button onClick={() => press('0')} disabled={busy}
            className="h-16 w-16 rounded-full bg-white/[0.04] text-2xl font-semibold ring-1 ring-white/10 transition-colors hover:bg-white/[0.08] active:bg-white/[0.12] disabled:opacity-40">
            0
          </button>
          <button onClick={() => { setError(null); setPinInput(pin.slice(0, -1)); }} disabled={busy}
            className="flex h-16 w-16 items-center justify-center rounded-full text-[color:var(--text-muted)] transition-colors hover:bg-white/[0.06]"
            aria-label="Apagar">
            <Delete size={22} />
          </button>
        </div>
      )}

      {bioOffered && !lockedOut && (
        <button onClick={tryBiometric} disabled={busy}
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-semibold text-[color:var(--text-secondary)] transition-colors hover:bg-white/[0.06] disabled:opacity-40">
          <Fingerprint size={18} /> Usar Face ID / biometria
        </button>
      )}

      <button onClick={onForceLogin}
        className="mt-8 type-caption text-[color:var(--text-muted)] underline underline-offset-4 transition-colors hover:text-[color:var(--text-secondary)]">
        Entrar com senha
      </button>
    </div>
  );
};

// ───────────────────────── Gate ─────────────────────────────────────────────
// Envolve o conteúdo autenticado. Trava no boot (se há PIN) e re-trava quando o
// aparelho volta de um tempo em segundo plano. Nunca trava se não houver PIN
// configurado (recurso é opt-in).
export const AppLockGate: React.FC<{ onForceLogin: () => void; children: React.ReactNode }> = ({ onForceLogin, children }) => {
  const [locked, setLocked] = useState<boolean>(() => isPinEnabled());
  const hiddenAt = useRef<number>(0);

  useEffect(() => {
    const onVis = () => {
      if (!isPinEnabled()) return;
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS) {
        setLocked(true);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (locked && isPinEnabled()) {
    return <LockScreen onUnlock={() => setLocked(false)} onForceLogin={onForceLogin} />;
  }
  return <>{children}</>;
};

// ───────────────────────── Configuração (em Ajustes) ────────────────────────
export const AppLockSettings: React.FC = () => {
  const { profile } = useCompanyContext();
  const [enabled, setEnabled] = useState(isPinEnabled());
  const [bioEnabled, setBioEnabled] = useState(isBiometricEnabled());
  const [bioAvailable, setBioAvailable] = useState(false);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { isBiometricAvailable().then(setBioAvailable); }, []);

  const createPin = async () => {
    setMsg(null);
    if (!isValidPinFormat(pin1)) { setMsg({ kind: 'err', text: 'O PIN deve ter de 4 a 6 dígitos.' }); return; }
    if (pin1 !== pin2) { setMsg({ kind: 'err', text: 'Os dois PINs não conferem.' }); return; }
    setBusy(true);
    try {
      await setPin(pin1);
      setEnabled(true);
      setPin1(''); setPin2('');
      setMsg({ kind: 'ok', text: 'PIN de bloqueio ativado.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Não foi possível salvar o PIN.' });
    } finally {
      setBusy(false);
    }
  };

  const removePin = () => {
    disablePin();
    disableBiometric();
    setEnabled(false);
    setBioEnabled(false);
    setMsg({ kind: 'ok', text: 'Bloqueio removido.' });
  };

  const toggleBio = async () => {
    setMsg(null);
    if (bioEnabled) {
      disableBiometric();
      setBioEnabled(false);
      setMsg({ kind: 'ok', text: 'Biometria desativada.' });
      return;
    }
    setBusy(true);
    const ok = await enableBiometric(profile?.id || 'user', profile?.full_name || 'Operador');
    setBusy(false);
    if (ok) { setBioEnabled(true); setMsg({ kind: 'ok', text: 'Biometria ativada.' }); }
    else setMsg({ kind: 'err', text: 'Não foi possível ativar a biometria neste aparelho.' });
  };

  const inputCls = 'w-full rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--bg-base)] px-4 py-3 text-[color:var(--text-primary)] text-sm tracking-[0.3em] outline-none focus:border-[color:var(--accent-steel)]';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)]">
          <ShieldCheck size={20} />
        </div>
        <div>
          <h3 className="type-title text-[color:var(--text-primary)]">Bloqueio do app</h3>
          <p className="type-caption text-[color:var(--text-muted)]">
            PIN para abrir o app no celular, inclusive sem internet. Não substitui seu login.
          </p>
        </div>
      </div>

      {msg && (
        <div className={`rounded-2xl px-4 py-3 type-caption ${msg.kind === 'ok' ? 'bg-[rgba(143,179,157,0.12)] text-[color:var(--accent-positive)]' : 'bg-[rgba(198,126,105,0.12)] text-[color:var(--accent-danger)]'}`}>
          {msg.text}
        </div>
      )}

      {!enabled ? (
        <div className="panel-card rounded-[1.6rem] p-5 space-y-3">
          <label className="block type-caption text-[color:var(--text-faint)]">Criar PIN (4 a 6 dígitos)</label>
          <input type="password" inputMode="numeric" maxLength={6} value={pin1}
            onChange={(e) => setPin1(e.target.value.replace(/\D/g, ''))} className={inputCls} placeholder="••••" />
          <input type="password" inputMode="numeric" maxLength={6} value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} className={inputCls} placeholder="Repita o PIN" />
          <button onClick={createPin} disabled={busy}
            className="w-full rounded-full bg-[color:var(--accent-brass)] px-5 py-3 text-sm font-bold text-[#17120b] transition-opacity hover:opacity-90 disabled:opacity-50">
            Ativar bloqueio
          </button>
        </div>
      ) : (
        <div className="panel-card rounded-[1.6rem] p-5 space-y-4">
          <div className="flex items-center gap-2 text-[color:var(--accent-positive)]">
            <ShieldCheck size={16} /> <span className="type-caption font-semibold">Bloqueio ativo</span>
          </div>

          {bioAvailable && (
            <button onClick={toggleBio} disabled={busy}
              className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition-colors hover:bg-white/[0.06] disabled:opacity-50">
              <span className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-secondary)]">
                <Fingerprint size={18} /> Desbloquear com Face ID / biometria
              </span>
              <span className={`type-caption font-bold ${bioEnabled ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--text-muted)]'}`}>
                {bioEnabled ? 'ATIVADO' : 'DESATIVADO'}
              </span>
            </button>
          )}

          <button onClick={removePin}
            className="w-full rounded-full border border-[rgba(198,126,105,0.3)] px-5 py-3 text-sm font-semibold text-[color:var(--accent-danger)] transition-colors hover:bg-[rgba(198,126,105,0.08)]">
            Remover bloqueio
          </button>
        </div>
      )}
    </div>
  );
};
