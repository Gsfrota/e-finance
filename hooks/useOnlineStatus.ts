import { useEffect, useState } from 'react';

/**
 * Estado da conexão, pelos eventos nativos do navegador.
 *
 * `navigator.onLine` é otimista: diz que há rede sempre que existe interface
 * ativa, mesmo sem internet de verdade (Wi-Fi de hotel, sinal de celular que
 * não trafega). Serve para o caso que importa no campo — modo avião, sinal
 * caindo entre uma casa e outra — e é o que a leitura offline precisa.
 * Detecção de "online mas sem trafegar" só faria sentido junto com a fila de
 * envio, que é a Entrega 3.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const ficouOnline = () => setOnline(true);
    const ficouOffline = () => setOnline(false);
    window.addEventListener('online', ficouOnline);
    window.addEventListener('offline', ficouOffline);
    return () => {
      window.removeEventListener('online', ficouOnline);
      window.removeEventListener('offline', ficouOffline);
    };
  }, []);

  return online;
}
