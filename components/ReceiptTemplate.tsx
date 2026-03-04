
import React from 'react';
import { LoanInstallment, Tenant } from '../types';
import { CheckCircle2, Building2, MapPin, Printer, Share2 } from 'lucide-react';

interface ReceiptTemplateProps {
  installment: LoanInstallment;
  tenant: Tenant;
  payerName?: string;
  onClose?: () => void;
}

const ReceiptTemplate: React.FC<ReceiptTemplateProps> = ({ installment, tenant, payerName, onClose }) => {
  const currentDate = new Date();
  const paidDate = installment.paid_at ? new Date(installment.paid_at) : currentDate;
  
  // Gerar um Hash visual para autenticidade
  const receiptHash = `REC-${installment.id.split('-')[0].toUpperCase()}-${paidDate.getFullYear()}`;

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const formatDate = (date: Date) => 
    date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const handlePrint = () => {
    window.print();
  };

  const handleShare = () => {
    const text = `🧾 *COMPROVANTE DE PAGAMENTO*\n\n*Beneficiário:* ${tenant.name}\n*Valor:* ${formatCurrency(Number(installment.amount_paid))}\n*Ref:* ${installment.contract_name} (Parc. ${installment.number})\n*Data:* ${formatDate(paidDate)}\n\n_Emitido digitalmente via E-Finance_`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-900 overflow-hidden rounded-[1.5rem] md:rounded-none">
      
      {/* CSS para Impressão - Injetado apenas quando este componente está montado */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #receipt-print-area, #receipt-print-area * {
            visibility: visible;
          }
          #receipt-print-area {
            position: fixed;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 20px;
            background: white;
            z-index: 9999;
          }
          @page {
            size: auto;
            margin: 0;
          }
          /* Esconder botões na impressão */
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* ÁREA IMPRESSA */}
      <div id="receipt-print-area" className="flex-1 p-8 md:p-10 flex flex-col bg-white overflow-y-auto">
        
        {/* Header */}
        <div className="border-b-2 border-slate-100 pb-6 mb-6 flex justify-between items-start">
            <div className="flex gap-4">
                {/* Logo ou Placeholder */}
                <div className="w-16 h-16 bg-slate-900 rounded-lg flex items-center justify-center text-white font-bold text-2xl">
                    {tenant.logo_url ? (
                        <img src={tenant.logo_url} alt="Logo" className="w-full h-full object-cover rounded-lg" />
                    ) : (
                        tenant.name.charAt(0)
                    )}
                </div>
                <div>
                    <h1 className="text-xl font-bold uppercase tracking-tight text-slate-900">{tenant.name}</h1>
                    <div className="text-xs text-slate-500 font-medium space-y-0.5 mt-1">
                        <p className="flex items-center gap-1"><Building2 size={10}/> {tenant.pix_key_type === 'CNPJ' ? tenant.pix_key : 'Documento Registrado'}</p>
                        {tenant.pix_city && <p className="flex items-center gap-1"><MapPin size={10}/> {tenant.pix_city}</p>}
                    </div>
                </div>
            </div>
            <div className="text-right">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Recibo Nº</div>
                <div className="text-sm font-mono font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded">{receiptHash}</div>
            </div>
        </div>

        {/* Status Badge */}
        <div className="flex justify-center mb-8">
            <div className="flex items-center gap-2 bg-emerald-100 text-emerald-700 px-6 py-2 rounded-full border border-emerald-200">
                <CheckCircle2 size={18} />
                <span className="text-sm font-bold uppercase tracking-wide">Pagamento Confirmado</span>
            </div>
        </div>

        {/* Valores */}
        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 mb-8">
            <div className="flex justify-between items-end mb-2">
                <span className="text-xs text-slate-500 font-bold uppercase tracking-widest">Valor Total Pago</span>
                <span className="text-3xl font-black text-slate-900">{formatCurrency(Number(installment.amount_paid))}</span>
            </div>
            <div className="w-full h-px bg-slate-200 my-4"></div>
            <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                    <span className="block text-slate-400 font-bold uppercase text-[10px]">Referência</span>
                    <span className="font-bold text-slate-700">{installment.contract_name}</span>
                </div>
                <div className="text-right">
                    <span className="block text-slate-400 font-bold uppercase text-[10px]">Parcela</span>
                    <span className="font-bold text-slate-700">#{installment.number}</span>
                </div>
            </div>
        </div>

        {/* Detalhes Técnicos */}
        <div className="space-y-3 text-xs mb-8">
            <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Pagador</span>
                <span className="font-bold text-slate-900 uppercase">{payerName || 'Cliente'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Data do Pagamento</span>
                <span className="font-bold text-slate-900">{formatDate(paidDate)}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Vencimento Original</span>
                <span className="font-bold text-slate-900">{new Date(installment.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
            </div>
            {(Number(installment.fine_amount) > 0 || Number(installment.interest_delay_amount) > 0) && (
                <div className="flex justify-between border-b border-slate-100 pb-2">
                    <span className="text-slate-500">Encargos (Multa/Juros)</span>
                    <span className="font-bold text-red-600">Included</span>
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="mt-auto pt-8 text-center">
            <p className="text-[9px] text-slate-400 font-medium uppercase tracking-wider">
                Autenticação Digital: {installment.id.split('-').join('')}
            </p>
            <p className="text-[8px] text-slate-300 mt-1">Gerado via E-Finance Suite</p>
        </div>
      </div>

      {/* BOTÕES DE AÇÃO (Não aparecem na impressão) */}
      <div className="p-4 bg-white border-t border-slate-200 flex gap-3 no-print">
         <button 
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 py-3 rounded-xl font-bold text-xs uppercase transition-colors"
         >
            <Share2 size={16}/> WhatsApp
         </button>
         <button 
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white py-3 rounded-xl font-bold text-xs uppercase transition-colors shadow-lg"
         >
            <Printer size={16}/> Imprimir
         </button>
         {onClose && (
             <button 
                onClick={onClose}
                className="px-6 py-3 rounded-xl font-bold text-xs uppercase text-slate-400 hover:text-slate-600 transition-colors"
             >
                Fechar
             </button>
         )}
      </div>
    </div>
  );
};

export default ReceiptTemplate;
