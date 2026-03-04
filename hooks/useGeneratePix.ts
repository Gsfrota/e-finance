import { useState } from 'react';
import { getSupabase } from '../services/supabase';

interface PixResponse {
  payload: string;
  amount: number;
  description: string;
  request_id: string;
}

interface GeneratePixResult {
  loading: boolean;
  error: string | null;
  data: PixResponse | null;
  generatePix: (installmentId: string) => Promise<void>;
  reset: () => void;
}

// Helper seguro para log de JWT (apenas payload visível)
const logJwtDiagnosis = (token: string) => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return console.warn("⚠️ [Security] Token JWT malformado.");
    
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    console.groupCollapsed("🔐 [Pix Security] JWT Diagnosis");
    console.log("Token Prefix:", parts[2].substring(0, 10) + "...");
    console.log("Issuer (iss):", payload.iss);
    console.log("Audience (aud):", payload.aud);
    console.log("Expiry (exp):", new Date(payload.exp * 1000).toLocaleTimeString());
    console.log("Role:", payload.role);
    console.groupEnd();
  } catch (e) {
    console.error("Erro ao diagnosticar token:", e);
  }
};

export const useGeneratePix = (): GeneratePixResult => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PixResponse | null>(null);

  const reset = () => {
    setData(null);
    setError(null);
    setLoading(false);
  };

  const generatePix = async (installmentId: string) => {
    setLoading(true);
    setError(null);
    const supabase = getSupabase();

    if (!supabase) {
      setError("Cliente Supabase não inicializado.");
      setLoading(false);
      return;
    }

    try {
      // 1. Validação de Sessão
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        console.warn("⚠️ [Pix] Sessão inválida ou expirada.");
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      // 2. Diagnóstico de Segurança (Logs)
      logJwtDiagnosis(session.access_token);

      console.log(`🚀 [Pix] Invocando Edge Function para parcela: ${installmentId}`);

      // 3. Chamada Principal via Invoke
      const { data: funcData, error: funcError } = await supabase.functions.invoke('generate-pix', {
        body: { installment_id: installmentId },
        headers: {
            // Opcional: headers customizados se necessário, mas invoke já manda Authorization
            // "x-client-info": "e-finance-web"
        }
      });

      // 4. Tratamento de Erro da Function
      if (funcError) {
        console.error("❌ [Pix] Erro na Edge Function:", funcError);
        
        // Interpretação de códigos HTTP comuns
        const status = (funcError as any)?.context?.response?.status;
        if (status === 401) throw new Error("Não autorizado (401). Verifique suas credenciais.");
        if (status === 403) throw new Error("Acesso negado (403). Você não tem permissão para esta parcela.");
        
        // Mensagem genérica ou repassada
        throw new Error(funcError.message || "Falha ao gerar Pix no servidor.");
      }

      // 5. Sucesso
      console.log("✅ [Pix] Sucesso. Request ID:", funcData.request_id);
      setData(funcData as PixResponse);

    } catch (err: any) {
      console.error("🔥 [Pix] Exceção Fatal:", err);
      
      // Fallback Opcional: Se quiser tentar fetch manual em caso de erro específico do SDK
      /* 
      if (err.message.includes('FetchError')) {
         // Implementação de Fetch Manual como última tentativa
         try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/generate-pix`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session?.access_token}`,
                    'apikey': process.env.SUPABASE_ANON_KEY || '',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ installment_id: installmentId })
            });
            if (res.ok) {
                const manualData = await res.json();
                setData(manualData);
                setLoading(false);
                return;
            }
         } catch (e) { console.error("Fallback failed", e); }
      }
      */

      setError(err.message || "Erro desconhecido ao processar pagamento.");
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, data, generatePix, reset };
};
