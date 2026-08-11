import React from 'react';
import { CloudOff, Clock } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { getNewestCachedAt } from '../services/cache';

interface OfflineBannerProps {
  /** Momento em que o dado na tela veio do servidor (epoch ms).
   *  Omitido, a faixa pergunta ao cache qual foi o último sync de carteira —
   *  é o caso quando ela vive no shell, fora de uma tela específica. */
  fetchedAt?: number | null;
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;

export function descreverIdade(fetchedAt: number, agora: number = Date.now()): string {
  const minutos = Math.floor((agora - fetchedAt) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias}d`;
}

/**
 * Diz que o app está sem rede e há quanto tempo o dado na tela foi atualizado.
 *
 * Fica escondido quando está tudo normal: aviso permanente vira ruído que o
 * operador aprende a ignorar. Passando de 24h sem atualizar, muda para o tom de
 * alerta — pela premissa registrada na spec, o cliente não fica um dia inteiro
 * sem rede, então dado mais velho que isso é anomalia, não rotina.
 */
const OfflineBanner: React.FC<OfflineBannerProps> = ({ fetchedAt }) => {
  const online = useOnlineStatus();
  if (online) return null;

  const momento = fetchedAt ?? getNewestCachedAt('dashboard_');
  const idade = momento ? descreverIdade(momento) : null;
  const velho = momento ? Date.now() - momento > UM_DIA_MS : false;

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-xs font-semibold ${
        velho
          ? 'bg-[rgba(239,68,68,0.16)] text-[color:var(--accent-negative)]'
          : 'bg-[rgba(240,180,41,0.14)] text-[color:var(--accent-brass)]'
      }`}
    >
      <CloudOff size={13} />
      <span>Sem conexão</span>
      {idade && (
        <>
          <Clock size={12} />
          <span>dados de {idade}</span>
        </>
      )}
    </div>
  );
};

export default OfflineBanner;
