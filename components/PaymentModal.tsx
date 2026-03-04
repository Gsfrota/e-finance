import React, { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { X, Copy, MessageCircle, AlertTriangle, CheckCircle2, Loader2, RefreshCw, Building2, MapPin, Info, ShieldCheck } from 'lucide-react';
import { DebtorInstallment } from '../hooks/useDebtorFinance';
import { getSupabase } from '../services/supabase';
import { useGeneratePix } from '../hooks/useGeneratePix';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  installment: DebtorInstallment | null;
  payerName: string;
}

const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, installment, payerName }) => {
  // Hook Customizado
  const { generatePix, loading, error, data, reset } = useGeneratePix();
  
  // UI States Locais
  const [beneficiary, setBeneficiary] = useState<{name: string, city: string} | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && installment) {
        // Dispara a geração segura
        generatePix(installment.id);
        fetchBeneficiary(installment.tenant_id);
    } else {
        // Limpa estados ao fechar
        reset();
        setBeneficiary(null);
    }
  }, [isOpen, installment]);

  const fetchBeneficiary = async (tenantId: string) => {
      const supabase = getSupabase();
      if (!supabase) return;
      const { data } = await supabase
        .from('tenants')
        .select('pix_name, pix_city')
        .eq('id', tenantId)
        .single();
      
      if (data) {
          setBeneficiary({
              name: data.pix_name || 'RECEBEDOR',
              city: data.pix_city || 'BRASILIA'
          });
      }
  };

  const handleCopy = () => {
    if (!data?.payload) return;
    navigator.clipboard.writeText(data.payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen || !installment) return null;

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const whatsappMessage = `Olá, sou o cliente ${payerName}. Tive problemas para pagar a parcela ${installment.number} do contrato ${installment.contract_name}.`;
  const whatsappLink = `https://wa.me/558431914090?text=${encodeURIComponent(whatsappMessage)}`;

  // Valor a exibir (Prioridade: Servidor > Parcela Local)
  const displayAmount = data?.amount ?? installment.amount_total;
  const displayDescription = data?.description ?? `Pagamento Parcela ${installment.number}`;

  return (
    <div data-testid="payment-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-800 border border-slate-700 rounded-3xl w-full max-w-md shadow-2xl flex flex-col relative overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-900/50">
          <div>
              <h3 className="text-lg font-black text-white uppercase tracking-tighter flex items-center gap-2">
                 <ShieldCheck className="text-teal-500" size={20}/> Pagamento Seguro
              </h3>
              <p className="text-xs text-slate-400 font-bold">{installment.contract_name} - Parc. {installment.number}</p>
          </div>
          <button data-testid="close-modal-btn" onClick={onClose} className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-8 flex flex-col items-center text-center space-y-6 overflow-y-auto max-h-[70vh] custom-scrollbar">
            
            {/* Amount Display */}
            <div className="w-full">
                <p className="text-xs text-slate-500 font-black uppercase tracking-widest mb-1">Valor Final</p>
                {loading ? (
                    <div className="h-10 w-32 bg-slate-700/50 rounded animate-pulse mx-auto mb-2"></div>
                ) : (
                    <div className="text-4xl font-black text-white">{formatCurrency(displayAmount)}</div>
                )}
                
                <div className="mt-2 text-[10px] text-teal-400 font-bold uppercase flex items-center justify-center gap-1 animate-fade-in">
                   <Info size={10}/> {displayDescription}
                </div>
            </div>

            {/* Beneficiary Card */}
            {beneficiary && (
                <div className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl p-4 flex items-center justify-between gap-3 animate-fade-in">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-teal-900/30 text-teal-400 rounded-lg">
                            <Building2 size={16} />
                        </div>
                        <div className="text-left">
                            <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Beneficiário</p>
                            <p className="text-xs font-bold text-white uppercase truncate max-w-[140px]">{beneficiary.name}</p>
                        </div>
                    </div>
                    <div className="text-right">
                         <div className="flex items-center justify-end gap-1 text-slate-500">
                            <MapPin size={10} />
                            <span className="text-[9px] font-bold uppercase">{beneficiary.city}</span>
                         </div>
                    </div>
                </div>
            )}

            {/* Content Area */}
            {loading ? (
                <div className="py-10 flex flex-col items-center gap-4 text-teal-500">
                    <Loader2 size={48} className="animate-spin"/>
                    <div className="flex flex-col items-center gap-1">
                        <p className="text-xs font-bold uppercase tracking-widest animate-pulse">Gerando Pix Dinâmico...</p>
                        <p className="text-[9px] text-slate-500 font-medium">Conectando à Edge Function</p>
                    </div>
                </div>
            ) : error ? (
                <div className="py-6 w-full animate-shake">
                    <div className="bg-red-900/20 border border-red-900/50 p-4 rounded-2xl flex flex-col items-center gap-2 text-red-400">
                        <AlertTriangle size={24} />
                        <p className="text-xs font-bold text-center">{error}</p>
                        <button onClick={() => generatePix(installment.id)} className="mt-2 text-[10px] font-black uppercase bg-red-900/40 px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-red-900/60 transition-colors">
                            <RefreshCw size={10} /> Tentar Novamente
                        </button>
                    </div>
                </div>
            ) : data && (
                <>
                    {/* QR Code Area */}
                    <div data-testid="qr-code" className="bg-white p-4 rounded-2xl shadow-lg shadow-black/50 relative group">
                         <div className="absolute -top-3 -right-3 bg-green-500 text-white p-1 rounded-full shadow-lg border-2 border-slate-800 z-10" title="Validado pelo Servidor">
                             <CheckCircle2 size={16} />
                         </div>
                        <QRCodeCanvas value={data.payload} size={256} level={"H"} />
                    </div>

                    {/* Pix Key Copy */}
                    <div className="w-full">
                        <label className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-2 block text-left">Pix Copia e Cola</label>
                        <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-1 flex items-center gap-2">
                            <input 
                                readOnly 
                                value={data.payload} 
                                className="bg-transparent w-full text-[10px] text-slate-400 font-mono px-3 outline-none truncate"
                            />
                            <button
                                data-testid="copy-pix-btn"
                                onClick={handleCopy}
                                className={`shrink-0 px-4 py-2.5 rounded-lg text-xs font-bold uppercase flex items-center gap-2 transition-all ${
                                    copied ? 'bg-green-600 text-white' : 'bg-teal-600 hover:bg-teal-500 text-white'
                                }`}
                            >
                                {copied ? <CheckCircle2 size={14}/> : <Copy size={14}/>}
                                {copied ? 'Copiado!' : 'Copiar'}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Negotiation CTA */}
            {installment.is_late && !loading && (
                <div className="w-full bg-amber-900/10 border border-amber-900/30 p-4 rounded-xl text-left">
                    <h4 className="text-amber-500 font-bold text-xs uppercase flex items-center gap-2 mb-2">
                        <AlertTriangle size={14}/> Dificuldades com o pagamento?
                    </h4>
                    <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="w-full bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2 transition-all mt-2">
                        <MessageCircle size={16}/> Falar com Suporte
                    </a>
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 bg-slate-900/30 text-center">
            <p className="text-slate-500 text-[10px] font-medium leading-relaxed">
                ID da Transação: <span className="font-mono text-slate-400">{data?.request_id ? data.request_id.split('-')[0] : '...'}</span> &bull; 
                Ambiente: <span className="text-teal-500">Edge Function Secure</span>
            </p>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal;
