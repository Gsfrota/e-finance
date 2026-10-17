// services/biometric.ts
//
// Desbloqueio por biometria nativa do aparelho (Face ID / Touch ID / digital)
// via WebAuthn com "platform authenticator". É uma CONVENIÊNCIA alternativa ao
// PIN para destravar a sessão local — não é autenticação de servidor.
//
// Degrada graciosamente: se o aparelho/navegador não suporta, as funções
// devolvem false e a UI simplesmente não oferece o botão de biometria.

const CRED_KEY = 'ef_app_lock_biocred_v1';

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function randomBytes(n: number): Uint8Array {
  return (globalThis.crypto as Crypto).getRandomValues(new Uint8Array(n));
}

/** O aparelho tem biometria utilizável (Face ID / Touch ID / digital)? */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !('PublicKeyCredential' in window)) return false;
    const PKC: any = (window as any).PublicKeyCredential;
    if (typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return false;
    return await PKC.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function isBiometricEnabled(): boolean {
  try { return !!localStorage.getItem(CRED_KEY); } catch { return false; }
}

export function disableBiometric(): void {
  try { localStorage.removeItem(CRED_KEY); } catch { /* noop */ }
}

/** Registra a biometria deste aparelho para este usuário. true = ativada. */
export async function enableBiometric(userId: string, userName: string): Promise<boolean> {
  try {
    if (!(await isBiometricAvailable())) return false;
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'Juros Certo', id: window.location.hostname },
        user: { id: new TextEncoder().encode(userId).slice(0, 64), name: userName, displayName: userName },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return false;
    localStorage.setItem(CRED_KEY, b64(cred.rawId));
    return true;
  } catch {
    return false;
  }
}

/** Pede a biometria para destravar. true = usuário confirmou com biometria. */
export async function unlockWithBiometric(): Promise<boolean> {
  try {
    const idB64 = (() => { try { return localStorage.getItem(CRED_KEY); } catch { return null; } })();
    if (!idB64) return false;
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: unb64(idB64) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}
