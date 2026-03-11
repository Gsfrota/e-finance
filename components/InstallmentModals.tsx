
import React, { useState, useEffect } from 'react';
import { LoanInstallment, Tenant } from '../types';
import { getSupabase } from '../services/supabase';
import { X, CheckCircle2, Calendar, DollarSign, Loader2, AlertTriangle, RefreshCw, Pencil, Save, Printer, Percent } from 'lucide-react';
import { parseSupabaseError } from '../services/supabase';
import ReceiptTemplate from './ReceiptTemplate';

// --- SHARED TYPES & HELPERS ---

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  installment: LoanInstallment | null;
  tenant?: Tenant | null; // Added Tenant for Receipts
  payerName?: string;     // Added Payer Name for Receipts
}

const formatCurrency = (val: number) => 
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const normalizeNumber = (val: any): number => {
    if (val === null || val === undefined) return 0;
    const num = Number(val);
    return isNaN(num) ? 0 : num;
};

const calculateOutstanding = (inst: LoanInstallment | null): number => {
    if (!inst) return 0;
    const total = normalizeNumber(inst.amount_total);
    const fine = normalizeNumber(inst.fine_amount);
    const delay = normalizeNumber(inst.interest_delay_amount);
    const paid = normalizeNumber(inst.amount_paid);
    return Math.max(0, (total + fine + delay) - paid);
};

const ModalBackdrop: React.FC<{ children: React.ReactNode, onClose: () => void }> = ({ children, onClose }) => (
  <div 
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in"
    onClick={onClose}
  >
    <div 
      className="bg-slate-800 border border-slate-700 rounded-[2rem] w-full max-w-md shadow-2xl relative overflow-hidden animate-fade-in-up"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  </div>
);

const Header: React.FC<{ title: string, subtitle: string, icon: React.ReactNode, onClose: () => void, colorClass: string }> = ({ 
  title, subtitle, icon, onClose, colorClass 
}) => (
  <div className="p-6 border-b border-slate-700 bg-slate-900/30 flex justify-between items-start">
    <div className="flex items-center gap-3">
      <div className={`p-3 rounded-xl bg-opacity-20 ${colorClass.replace('text-', 'bg-')} ${colorClass}`}>
        {icon}
      </div>
      <div>
        <h3 className="text-lg font-black text-white uppercase tracking-tighter">{title}</h3>
        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{subtitle}</p>
      </div>
    </div>
    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-2 hover:bg-slate-700 rounded-full">
      <X size={20} />
    </button>
  </div>
);

// --- 1. PAYMENT MODAL (Dar Baixa & Comprovante) ---

export const PaymentModal: React.FC<BaseModalProps> = ({ isOpen, onClose, onSuccess, installment, tenant, payerName }) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReceiptMode, setIsReceiptMode] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('PIX');

  const outstanding = calculateOutstanding(installment);

  useEffect(() => {
    if (isOpen && installment) {
      setError(null);
      setPaymentMethod('PIX');
      // Check if already paid (History Mode)
      if (installment.status === 'paid') {
          setIsReceiptMode(true);
      } else {
          setAmount(outstanding.toFixed(2));
          setIsReceiptMode(false);
      }
    }
  }, [isOpen, installment, outstanding]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!installment) return;
    
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
        setError("O valor deve ser maior que zero.");
        return;
    }

    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { error: rpcError } = await supabase.rpc('pay_installment', {
        p_installment_id: installment.id,
        p_amount_paid: val
      });

      if (rpcError) throw rpcError;
      
      // UPDATE: Instead of closing, switch to receipt mode
      onSuccess(); // Refresh parent data in background
      
      // Manually update local installment state to reflect payment for the receipt
      if (installment) {
          installment.amount_paid = val; // Visual update only
          installment.paid_at = new Date().toISOString();
      }
      setIsReceiptMode(true);

    } catch (err: any) {
      setError(err.message || 'Erro ao processar pagamento.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !installment) return null;

  // RENDER RECEIPT MODE
  if (isReceiptMode && tenant) {
      return (
          <ModalBackdrop onClose={onClose}>
              <div className="bg-white h-full max-h-[90vh] flex flex-col">
                 <ReceiptTemplate
                    installment={installment}
                    tenant={tenant}
                    payerName={payerName || installment.investment?.payer?.full_name}
                    paymentMethod={paymentMethod}
                    onClose={onClose}
                 />
              </div>
          </ModalBackdrop>
      );
  } else if (isReceiptMode && !tenant) {
      // Fallback if tenant data is missing (Should not happen in correct implementation)
      return (
        <ModalBackdrop onClose={onClose}>
             <div className="p-8 text-center">
                 <CheckCircle2 size={48} className="mx-auto text-emerald-500 mb-4"/>
                 <h3 className="text-white font-bold text-xl mb-2">Pagamento Confirmado!</h3>
                 <p className="text-slate-400 text-sm mb-6">O recibo não pôde ser gerado pois os dados da empresa não foram carregados.</p>
                 <button onClick={onClose} className="bg-slate-700 text-white px-6 py-2 rounded-xl text-xs font-bold uppercase">Fechar</button>
             </div>
        </ModalBackdrop>
      );
  }

  // RENDER FORM MODE
  return (
    <ModalBackdrop onClose={onClose}>
      <Header 
        title="Baixa de Pagamento" 
        subtitle={`Parcela #${installment.number}`} 
        icon={<CheckCircle2 size={24}/>} 
        onClose={onClose}
        colorClass="text-emerald-500"
      />
      
      <form onSubmit={handleSubmit} className="p-8 space-y-6">
        <div className="bg-emerald-900/10 border border-emerald-900/30 p-4 rounded-2xl text-center">
            <p className="text-xs text-emerald-400 font-bold uppercase tracking-widest mb-1">Valor Total Pendente</p>
            <p className="text-3xl font-black text-white">{formatCurrency(outstanding)}</p>
            {(installment.fine_amount > 0 || installment.interest_delay_amount > 0) && (
                <p className="text-[10px] text-emerald-500/70 mt-1 uppercase font-bold">
                    Inclui Multas e Juros de Atraso
                </p>
            )}
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
              Valor Recebido (R$)
            </label>
            <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-emerald-500"/>
                <input
                  type="number" step="0.01" inputMode="decimal" required
                  value={amount} onChange={e => setAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3.5 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                />
            </div>
          </div>
          
          <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/50 border border-slate-700/50 text-slate-400 text-xs">
              <Calendar size={14} className="shrink-0" />
              <span>Data da baixa: <strong>Hoje ({new Date().toLocaleDateString('pt-BR')})</strong></span>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
              Forma de Pagamento
            </label>
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3.5 text-white outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm"
            >
              <option value="PIX">PIX</option>
              <option value="Dinheiro">Dinheiro</option>
              <option value="Transferência Bancária">Transferência Bancária</option>
              <option value="Boleto Bancário">Boleto Bancário</option>
              <option value="Cartão">Cartão</option>
              <option value="Cheque">Cheque</option>
            </select>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        <button
          type="submit" disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all active:scale-[0.98]"
        >
          {loading ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle2 size={18}/>}
          {loading ? 'Processando...' : 'Confirmar Recebimento'}
        </button>
      </form>
    </ModalBackdrop>
  );
};

// --- 2. REFINANCE MODAL (Refinanciar) ---

export const RefinanceModal: React.FC<BaseModalProps> = ({ isOpen, onClose, onSuccess, installment }) => {
  const [payAmount, setPayAmount] = useState('');
  const [newDate, setNewDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPayAmount('');
      // Default to 30 days from now
      const d = new Date();
      d.setDate(d.getDate() + 30);
      setNewDate(d.toISOString().split('T')[0]);
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!installment) return;

    const val = parseFloat(payAmount);
    if (isNaN(val) || val < 0) {
        setError("O valor de entrada não pode ser negativo.");
        return;
    }
    if (!newDate) {
        setError("Selecione uma nova data de vencimento.");
        return;
    }

    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { error: rpcError } = await supabase.rpc('refinance_installment', {
        p_installment_id: installment.id,
        p_payment_amount: val,
        p_new_due_date: newDate
      });

      if (rpcError) throw rpcError;
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro no refinanciamento.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !installment) return null;

  return (
    <ModalBackdrop onClose={onClose}>
      <Header 
        title="Refinanciar Saldo" 
        subtitle="Postergar Dívida" 
        icon={<RefreshCw size={24}/>} 
        onClose={onClose}
        colorClass="text-purple-400"
      />
      
      <form onSubmit={handleSubmit} className="p-8 space-y-6">
        <div className="bg-purple-900/10 border border-purple-900/30 p-4 rounded-xl flex gap-3">
             <AlertTriangle className="text-purple-400 shrink-0 mt-0.5" size={18} />
             <p className="text-xs text-purple-200 leading-relaxed font-medium">
                Esta ação paga o valor de entrada e re-agenda o saldo restante para a nova data, mantendo o status "Pendente".
             </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
              Valor de Entrada (Pago Hoje)
            </label>
            <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-purple-400"/>
                <input
                  type="number" step="0.01" inputMode="decimal" required
                  value={payAmount} onChange={e => setPayAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3.5 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                />
            </div>
          </div>
          
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
              Nova Data de Vencimento
            </label>
            <div className="relative">
                <Calendar size={16} className="absolute left-4 top-4 text-slate-500"/>
                <input 
                  type="date" required
                  value={newDate} onChange={e => setNewDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3.5 text-white font-sans text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                />
            </div>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        <button 
          type="submit" disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-purple-900/20 transition-all active:scale-[0.98]"
        >
          {loading ? <Loader2 className="animate-spin" size={18}/> : <RefreshCw size={18}/>}
          {loading ? 'Calculando...' : 'Confirmar Refinanciamento'}
        </button>
      </form>
    </ModalBackdrop>
  );
};

// --- 3. EDIT MODAL (Admin Edit) ---

export const EditModal: React.FC<BaseModalProps> = ({ isOpen, onClose, onSuccess, installment }) => {
  const [totalAmount, setTotalAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && installment) {
      setTotalAmount(installment.amount_total.toString());
      // Ensure valid date format YYYY-MM-DD
      const dateVal = installment.due_date ? new Date(installment.due_date).toISOString().split('T')[0] : '';
      setDueDate(dateVal);
      setError(null);
    }
  }, [isOpen, installment]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!installment) return;
    
    const val = parseFloat(totalAmount);
    if (isNaN(val) || val <= 0) {
        setError("O valor total deve ser positivo.");
        return;
    }
    if (!dueDate) {
        setError("Data de vencimento inválida.");
        return;
    }

    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { error: rpcError } = await supabase.rpc('admin_update_installment', {
        p_installment_id: installment.id,
        p_new_amount_total: val,
        p_new_due_date: dueDate
      });

      if (rpcError) throw rpcError;
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro na edição.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !installment) return null;

  return (
    <ModalBackdrop onClose={onClose}>
      <Header 
        title="Edição Administrativa" 
        subtitle="Correção Manual de Dados" 
        icon={<Pencil size={24}/>} 
        onClose={onClose}
        colorClass="text-sky-400"
      />
      
      <form onSubmit={handleSubmit} className="p-8 space-y-6">
        <div className="bg-sky-900/10 border border-sky-900/30 p-4 rounded-xl flex gap-3">
             <AlertTriangle className="text-sky-400 shrink-0 mt-0.5" size={18} />
             <p className="text-xs text-sky-200 leading-relaxed font-medium">
                Altera o valor total e o vencimento diretamente. Use apenas para corrigir erros de cadastro.
             </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
              Nova Data de Vencimento
            </label>
            <div className="relative">
                <Calendar size={16} className="absolute left-4 top-4 text-slate-500"/>
                <input 
                  type="date" required
                  value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3.5 text-white font-sans text-sm outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
              Novo Valor Total (Principal + Juros)
            </label>
            <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-slate-500"/>
                <input
                  type="number" step="0.01" inputMode="decimal" required
                  value={totalAmount} onChange={e => setTotalAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3.5 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                />
            </div>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        <button
          type="submit" disabled={loading}
          className="w-full bg-sky-600 hover:bg-sky-500 text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-sky-900/20 transition-all active:scale-[0.98]"
        >
          {loading ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>}
          {loading ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </form>
    </ModalBackdrop>
  );
};

// --- 4. INTEREST ONLY MODAL (Pagar Só Juros) ---

export const InterestOnlyModal: React.FC<BaseModalProps> = ({ isOpen, onClose, onSuccess, installment }) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAmount('');
      setError(null);
    }
  }, [isOpen]);

  const outstanding = calculateOutstanding(installment);
  const totalInterestPaid = normalizeNumber(installment?.interest_payments_total);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0 || !installment) { setError('Informe um valor válido.'); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      const { error: rpcError } = await supabase.rpc('pay_interest_only', {
        p_installment_id: installment.id,
        p_interest_amount: val
      });
      if (rpcError) throw rpcError;
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(parseSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !installment) return null;

  return (
    <ModalBackdrop onClose={onClose}>
      <Header
        title="Pagar Só Juros"
        subtitle={`Parcela #${installment.number}`}
        icon={<Percent size={24}/>}
        onClose={onClose}
        colorClass="text-amber-400"
      />

      <form onSubmit={handleSubmit} className="p-8 space-y-5">
        <div className="bg-amber-900/10 border border-amber-900/30 p-4 rounded-2xl">
          <p className="text-[10px] text-amber-400/80 font-black uppercase tracking-widest mb-1">Parcela Original</p>
          <p className="text-2xl font-black text-white">{formatCurrency(outstanding)}</p>
          <p className="text-[10px] text-amber-500/70 mt-1 font-bold uppercase">Ainda em aberto</p>
        </div>

        {totalInterestPaid > 0 && (
          <div className="bg-slate-900/50 border border-slate-700/50 p-3 rounded-xl flex justify-between items-center">
            <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Juros já cobrados</span>
            <span className="text-amber-400 font-black text-sm">{formatCurrency(totalInterestPaid)}</span>
          </div>
        )}

        <div>
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
            Valor dos Juros (R$)
          </label>
          <div className="relative">
            <Percent size={16} className="absolute left-4 top-4 text-amber-400"/>
            <input
              type="number" step="0.01" required autoFocus
              value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0,00"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3.5 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        <div className="bg-amber-900/10 border border-amber-800/30 p-3 rounded-xl flex gap-2.5 items-start">
          <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5"/>
          <p className="text-[10px] text-amber-200/80 leading-relaxed font-medium">
            O valor da parcela <strong>não será descontado</strong>. A parcela continua em aberto após este registro.
          </p>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
            <AlertTriangle size={14}/> {error}
          </div>
        )}

        <button
          type="submit" disabled={loading}
          className="w-full bg-amber-600 hover:bg-amber-500 text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-amber-900/20 transition-all active:scale-[0.98]"
        >
          {loading ? <Loader2 className="animate-spin" size={18}/> : <Percent size={18}/>}
          {loading ? 'Registrando...' : 'Registrar Pagamento de Juros'}
        </button>
      </form>
    </ModalBackdrop>
  );
};
