
import React, { useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { LoanInstallment, Tenant } from '../types';
import { Share2, X, Loader2 } from 'lucide-react';

interface ReceiptTemplateProps {
  installment: LoanInstallment;
  tenant: Tenant;
  payerName?: string;
  paymentMethod?: string;
  onClose?: () => void;
}

const ReceiptTemplate: React.FC<ReceiptTemplateProps> = ({
  installment,
  tenant,
  payerName,
  paymentMethod = 'PIX',
  onClose,
}) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const [shareBlob, setShareBlob] = useState<Blob | null>(null);

  const paidDate = installment.paid_at ? new Date(installment.paid_at) : new Date();
  const clientName = payerName || 'Cliente';
  const totalPaid = Number(installment.amount_paid);
  const installmentAmount = Number(installment.amount_total);
  const hasPenalties = Number(installment.fine_amount) > 0 || Number(installment.interest_delay_amount) > 0;

  const fmtCurrency = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const fmtDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
  };

  const fmtPaidDate = paidDate.toLocaleDateString('pt-BR');
  const fmtPaidTime = paidDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Gera o PNG no mount para compartilhamento
  useEffect(() => {
    let cancelled = false;
    const generate = async () => {
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (cancelled || !receiptRef.current) return;
      try {
        const dataUrl = await toPng(receiptRef.current, {
          pixelRatio: 2,
          backgroundColor: '#ffffff',
          filter: (node) => !(node as HTMLElement).hasAttribute?.('data-html2canvas-ignore'),
        });
        if (cancelled) return;
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        if (!cancelled) setShareBlob(blob);
      } catch (err) {
        console.error('Erro ao gerar imagem:', err);
      }
    };
    setShareBlob(null);
    generate();
    return () => { cancelled = true; };
  }, []);

  const handleShare = async () => {
    if (sharing || !shareBlob) return;
    setSharing(true);
    try {
      const file = new File([shareBlob], `comprovante-parcela${installment.number}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const url = URL.createObjectURL(shareBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comprovante-parcela${installment.number}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Erro ao compartilhar:', err);
    } finally {
      setSharing(false);
    }
  };

  const rows = [
    { label: 'Parcela Vencimento', value: fmtDate(installment.due_date) },
    { label: 'Valor da parcela',   value: fmtCurrency(installmentAmount) },
    { label: 'Pagamentos realizados', value: fmtCurrency(totalPaid) },
    ...(hasPenalties ? [{
      label: 'Encargos (multa/juros)',
      value: fmtCurrency(Number(installment.fine_amount) + Number(installment.interest_delay_amount)),
    }] : []),
    { label: 'Forma de pagamento', value: paymentMethod },
    { label: 'Data do pagamento',  value: fmtPaidDate },
    { label: 'Horario do pagamento', value: fmtPaidTime },
  ];

  return (
    <div className="flex flex-col bg-white" style={{ minHeight: '100%' }}>

      {/* Área capturada como imagem */}
      <div
        ref={receiptRef}
        style={{
          background: '#ffffff',
          width: '100%',
          maxWidth: 380,
          margin: '0 auto',
          padding: '32px 28px 24px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.12em', color: '#111', textTransform: 'uppercase', margin: 0 }}>
            Comprovante
          </p>
          {installment.contract_name && (
            <p style={{ fontSize: 13, color: '#555', marginTop: 4, marginBottom: 0 }}>
              {installment.contract_name}
            </p>
          )}
          <p style={{ fontSize: 12, color: '#777', marginTop: 2, marginBottom: 0 }}>
            {tenant.name}
          </p>
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid #e5e7eb', marginBottom: 16 }} />

        {/* Parcela + Devedor */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Devedor</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#111', textAlign: 'right', maxWidth: '60%' }}>
              {clientName}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Parcela Número</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>
              {installment.number}
            </span>
          </div>
        </div>

        {/* Status badge */}
        <div style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 8,
          padding: '8px 12px',
          textAlign: 'center',
          marginBottom: 16,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>
            ✓ A parcela nº {installment.number} foi paga
          </span>
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px dashed #e5e7eb', marginBottom: 14 }} />

        {/* Rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{row.label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#111', textAlign: 'right', marginLeft: 12 }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 20, paddingTop: 12, textAlign: 'center' }}>
          <p style={{ fontSize: 10, color: '#9ca3af', margin: 0, letterSpacing: '0.05em' }}>
            {tenant.name} · Juros Certo
          </p>
        </div>
      </div>

      {/* Botões de ação (fora da imagem) */}
      <div data-html2canvas-ignore className="flex gap-2 px-4 py-3 border-t bg-white" style={{ maxWidth: 380, margin: '0 auto', width: '100%' }}>
        <button
          onClick={handleShare}
          disabled={sharing || !shareBlob}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
          style={{ background: '#25D366', color: '#fff' }}
        >
          {(sharing || !shareBlob)
            ? <><Loader2 size={16} className="animate-spin" /> {!shareBlob ? 'Gerando...' : 'Enviando...'}</>
            : <><Share2 size={16} /> WhatsApp</>}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-3 rounded-xl transition-colors flex items-center justify-center cursor-pointer text-gray-400 hover:text-gray-600"
            aria-label="Fechar comprovante"
          >
            <X size={18} />
          </button>
        )}
      </div>

    </div>
  );
};

export default ReceiptTemplate;
