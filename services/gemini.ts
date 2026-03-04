
import { GoogleGenAI } from "@google/genai";
import { Investment } from "../types";

export interface ParsedContract {
  debtor_name: string;
  amount_invested: number;
  current_value: number;
  installment_value: number;
  total_installments: number;
  due_day: number | null;
  frequency: 'monthly' | 'weekly' | 'daily';
  calculation_mode: 'manual';
}

export const analyzePortfolio = async (investments: Investment[]): Promise<string> => {
  const isProd = window.location.hostname !== 'localhost';
  
  if (!process.env.API_KEY) {
    return isProd 
      ? "Análise indisponível no momento." 
      : "Erro: API_KEY ausente no process.env (Apenas em DEV).";
  }

  // Fix: Direct use of process.env.API_KEY in the constructor as required by guidelines.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    Atue como um Consultor Financeiro Sênior.
    Analise o portfólio abaixo em Português (Brasil).
    Seja conciso e institucional.
    
    Dados:
    ${JSON.stringify(investments)}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    // Fix: Accessing the .text property directly (not a method call).
    return response.text || "Análise concluída sem observações relevantes.";
  } catch (error) {
    // Em produção, não logamos o erro completo para o usuário final
    return "O consultor de IA está processando outros dados. Tente novamente em breve.";
  }
};

export const parseContractFromText = async (text: string): Promise<ParsedContract> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY ausente. Configure GEMINI_API_KEY no ambiente.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `Você é um assistente de gestão de crédito brasileiro. Analise a frase abaixo e extraia os dados de um contrato de empréstimo.

Retorne SOMENTE um objeto JSON válido, sem markdown, sem explicações, com exatamente estas chaves:
{
  "debtor_name": "nome do devedor/tomador",
  "amount_invested": numero (valor principal emprestado),
  "current_value": numero (total a ser pago pelo devedor, principal + juros),
  "installment_value": numero (valor de cada parcela),
  "total_installments": numero inteiro (quantidade de parcelas),
  "due_day": numero ou null (dia do mês para pagamento, null se não informado ou se for semanal/diário),
  "frequency": "monthly" ou "weekly" ou "daily",
  "calculation_mode": "manual"
}

Regras de inferência:
- Se mencionar "todo dia X" ou "dia X" → due_day = X, frequency = "monthly"
- Se mencionar "por semana" ou "toda semana" → frequency = "weekly", due_day = null
- Se não informar current_value mas informar parcela e total de parcelas → calcule: installment_value * total_installments
- Se não informar installment_value mas informar current_value e total_installments → calcule: current_value / total_installments
- Valores como "mil" = 1000, "2mil" = 2000, "2,5k" = 2500

Frase do usuário: "${text.replace(/"/g, "'")}"`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
  });

  const raw = (response.text || '').trim();
  // Remove possíveis blocos de código markdown
  const cleaned = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as ParsedContract;
    return parsed;
  } catch {
    throw new Error(`Não foi possível interpretar a resposta da IA. Tente reformular a frase.\n\nResposta: ${raw.substring(0, 200)}`);
  }
};
