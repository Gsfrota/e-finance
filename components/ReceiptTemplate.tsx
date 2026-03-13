
import React, { useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { LoanInstallment, Tenant } from '../types';
import { CheckCircle2, Printer, Share2, X, Loader2, Sun, Moon } from 'lucide-react';

interface ReceiptTemplateProps {
  installment: LoanInstallment;
  tenant: Tenant;
  payerName?: string;
  paymentMethod?: string;
  onClose?: () => void;
}

type ReceiptTheme = 'dark' | 'light';

// ── Token maps por tema ──────────────────────────────────────────────────────
const THEMES = {
  dark: {
    outerBg:       '#0a0a0f',
    receiptBg:     'linear-gradient(180deg, #0d0d14 0%, #111827 100%)',
    wrapperBg:     'linear-gradient(180deg, #0d0d14 0%, #111827 100%)',
    glowColor:     'rgba(201,168,76,0.15)',
    logoBg:        'linear-gradient(135deg, #1e293b, #0f172a)',
    logoBorder:    'rgba(201,168,76,0.35)',
    logoText:      '#C9A84C',
    companyName:   '#F1F5F9',
    subtitle:      '#C9A84C',
    hashBg:        'rgba(255,255,255,0.06)',
    hashColor:     '#64748B',
    dividerGold:   'rgba(201,168,76,0.25)',
    dividerMid:    'rgba(255,255,255,0.1)',
    dividerFooter: 'rgba(201,168,76,0.2)',
    badgeBg:       'rgba(16,185,129,0.1)',
    badgeBorder:   'rgba(16,185,129,0.25)',
    badgeColor:    '#34D399',
    amountLabel:   '#475569',
    amountValue:   '#F8FAFC',
    penaltyColor:  '#F59E0B',
    rowLabel:      '#64748B',
    rowValue:      '#CBD5E1',
    highlightColor:'#F59E0B',
    footerAuth:    '#334155',
    footerBrand:   '#C9A84C',
    actionBg:      '#0d0d14',
    actionBorder:  'rgba(201,168,76,0.15)',
    shareBg:       'rgba(255,255,255,0.05)',
    shareBorder:   '1px solid rgba(255,255,255,0.1)',
    shareColor:    '#94A3B8',
    shareHover:    'rgba(255,255,255,0.09)',
    htmlCanvas:    '#0d0d14',
  },
  light: {
    outerBg:       '#f4f6fa',
    receiptBg:     '#ffffff',
    wrapperBg:     '#f4f6fa',
    glowColor:     'rgba(201,131,14,0.08)',
    logoBg:        'linear-gradient(135deg, #1e293b, #0f172a)',
    logoBorder:    'rgba(201,131,14,0.4)',
    logoText:      '#C9A84C',
    companyName:   '#0d1b2e',
    subtitle:      '#c9830e',
    hashBg:        'rgba(15,29,60,0.06)',
    hashColor:     '#6b7fa0',
    dividerGold:   'rgba(201,131,14,0.3)',
    dividerMid:    'rgba(15,29,60,0.1)',
    dividerFooter: 'rgba(201,131,14,0.25)',
    badgeBg:       'rgba(5,150,105,0.08)',
    badgeBorder:   'rgba(5,150,105,0.3)',
    badgeColor:    '#059669',
    amountLabel:   '#6b7fa0',
    amountValue:   '#0d1b2e',
    penaltyColor:  '#d97706',
    rowLabel:      '#6b7fa0',
    rowValue:      '#2a3a56',
    highlightColor:'#d97706',
    footerAuth:    '#a8b8d8',
    footerBrand:   '#c9830e',
    actionBg:      '#ffffff',
    actionBorder:  'rgba(15,29,60,0.12)',
    shareBg:       'rgba(15,29,60,0.04)',
    shareBorder:   '1px solid rgba(15,29,60,0.15)',
    shareColor:    '#6b7fa0',
    shareHover:    'rgba(15,29,60,0.08)',
    htmlCanvas:    '#ffffff',
  },
} as const;

const ReceiptTemplate: React.FC<ReceiptTemplateProps> = ({
  installment,
  tenant,
  payerName,
  paymentMethod = 'PIX',
  onClose,
}) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const [receiptTheme, setReceiptTheme] = useState<ReceiptTheme>('dark');
  const [shareBlob, setShareBlob] = useState<Blob | null>(null);

  const t = THEMES[receiptTheme];
  const isDark = receiptTheme === 'dark';

  const currentDate = new Date();
  const paidDate = installment.paid_at ? new Date(installment.paid_at) : currentDate;

  const receiptHash = `REC-${installment.id.split('-')[0].toUpperCase()}-${paidDate.getFullYear()}`;
  const creditorName = tenant.owner_name || tenant.pix_name || tenant.name;
  const clientName = payerName || 'Cliente';
  const totalPaid = Number(installment.amount_paid);
  const hasPenalties = Number(installment.fine_amount) > 0 || Number(installment.interest_delay_amount) > 0;
  const contractId = installment.investment_id || (installment.investment?.id);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const formatDate = (date: Date) =>
    date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const formatDateShort = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const weekday = d.toLocaleDateString('pt-BR', { weekday: 'long' });
    const date = d.toLocaleDateString('pt-BR');
    return `${weekday}, ${date}`;
  };

  const handlePrint = () => window.print();

  // Pré-gera o PNG no mount (e ao trocar tema) usando html-to-image (SVG foreignObject)
  useEffect(() => {
    let cancelled = false;

    const generate = async () => {
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (cancelled || !receiptRef.current) return;

      try {
        const dataUrl = await toPng(receiptRef.current, {
          pixelRatio: 2,
          backgroundColor: t.htmlCanvas,
          // Filtra elementos com data-html2canvas-ignore (convenção compartilhada)
          filter: (node) => !(node as HTMLElement).hasAttribute?.('data-html2canvas-ignore'),
        });
        if (cancelled) return;
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        if (!cancelled) setShareBlob(blob);
      } catch (err) {
        console.error('Erro ao pré-gerar imagem:', err);
      }
    };

    setShareBlob(null);
    generate();
    return () => { cancelled = true; };
  }, [receiptTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleShare = async () => {
    if (sharing || !shareBlob) return;
    setSharing(true);
    try {
      const file = new File([shareBlob], `comprovante-${receiptHash}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Comprovante ${receiptHash}` });
      } else {
        const url = URL.createObjectURL(shareBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comprovante-${receiptHash}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Erro ao compartilhar:', err);
    } finally {
      setSharing(false);
    }
  };

  const detailRows: { label: string; value: string; highlight?: boolean }[] = [
    { label: 'Contrato',   value: installment.contract_name || '—' },
    { label: 'ID',         value: contractId ? `#${contractId}` : '—' },
    { label: 'Parcela',    value: `#${installment.number}` },
    { label: 'Vencimento', value: formatDateShort(installment.due_date) },
    { label: 'Pagamento',  value: formatDate(paidDate) },
    { label: 'Forma',      value: paymentMethod },
    ...(hasPenalties ? [{
      label: 'Encargos',
      value: formatCurrency(Number(installment.fine_amount) + Number(installment.interest_delay_amount)),
      highlight: true,
    }] : []),
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden rounded-[1.5rem] md:rounded-none"
      style={{ background: t.outerBg }}>

      {/* ── Print CSS ──────────────────────────────── */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #receipt-print-area, #receipt-print-area * { visibility: visible; }
          #receipt-print-area {
            position: fixed; left: 0; top: 0;
            width: 100%; height: 100%;
            margin: 0; padding: 28px;
            background: ${isDark ? '#0d0d14' : '#fff'} !important;
            color: ${isDark ? '#F8FAFC' : '#0d1b2e'} !important;
            z-index: 9999;
          }
          #receipt-print-area .receipt-bg-gradient { display: none !important; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 0; }
        }
      `}</style>

      {/* ── Theme toggle bar (above receipt) ──────── */}
      <div className="no-print flex items-center justify-between px-4 py-2 border-b shrink-0"
        style={{ background: t.actionBg, borderColor: t.actionBorder }}>
        <span className="text-[9px] font-bold uppercase tracking-[0.2em]"
          style={{ color: t.shareColor }}>
          Modo do comprovante
        </span>
        <div className="flex items-center gap-1 p-0.5 rounded-lg"
          style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,29,60,0.06)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,29,60,0.12)'}` }}>
          <button
            onClick={() => setReceiptTheme('dark')}
            className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all"
            style={isDark
              ? { background: '#C9A84C', color: '#0a0a0f' }
              : { color: t.shareColor, background: 'transparent' }}
          >
            <Moon size={11} /> Escuro
          </button>
          <button
            onClick={() => setReceiptTheme('light')}
            className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all"
            style={!isDark
              ? { background: '#c9830e', color: '#fff' }
              : { color: t.shareColor, background: 'transparent' }}
          >
            <Sun size={11} /> Claro
          </button>
        </div>
      </div>

      {/* ── Scrollable wrapper ─────────────────────── */}
      <div id="receipt-print-area" className="flex-1 overflow-y-auto flex justify-center"
        style={{ background: t.wrapperBg }}>

        {/* ── Narrow receipt column (captured by html2canvas) ── */}
        <div ref={receiptRef}
          className="relative w-full px-5 pt-6 pb-5 overflow-hidden"
          style={{ maxWidth: '380px', background: t.receiptBg }}>

          {/* Glow top */}
          <div className="receipt-bg-gradient pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-72 h-24 rounded-full"
            aria-hidden="true"
            style={{ background: `radial-gradient(ellipse, ${t.glowColor} 0%, transparent 70%)` }} />

          {/* ── Header ── */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="receipt-logo-box w-9 h-9 rounded-lg flex items-center justify-center font-black text-base overflow-hidden shrink-0"
                style={{ background: t.logoBg, border: `1px solid ${t.logoBorder}` }}>
                {tenant.logo_url
                  ? <img src={tenant.logo_url} alt="Logo" className="w-full h-full object-cover rounded-lg" />
                  : <span style={{ color: t.logoText }}>{tenant.name.charAt(0)}</span>}
              </div>
              <div>
                <p className="receipt-company-name text-xs font-black uppercase tracking-[0.18em]"
                  style={{ color: t.companyName }}>{tenant.name}</p>
                <p className="text-[9px] font-bold uppercase tracking-widest"
                  style={{ color: t.subtitle }}>Comprovante de Pagamento</p>
              </div>
            </div>
            <span className="receipt-hash text-[9px] font-mono font-bold px-2 py-0.5 rounded"
              style={{ background: t.hashBg, color: t.hashColor }}>{receiptHash}</span>
          </div>

          {/* Divider gold */}
          <div className="receipt-dash-divider border-t border-dashed mb-4"
            style={{ borderColor: t.dividerGold }} />

          {/* Badge */}
          <div className="flex justify-center mb-3">
            <div className="receipt-confirmed-badge inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide"
              style={{ background: t.badgeBg, border: `1px solid ${t.badgeBorder}`, color: t.badgeColor }}>
              <CheckCircle2 size={12} /> Pago
            </div>
          </div>

          {/* Amount */}
          <div className="text-center mb-4">
            <p className="receipt-amount-label text-[9px] font-black uppercase tracking-[0.2em] mb-1"
              style={{ color: t.amountLabel }}>Valor Total Pago</p>
            <p className="receipt-amount-value font-black"
              style={{ fontSize: 'clamp(1.75rem, 7vw, 2.25rem)', color: t.amountValue, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              {formatCurrency(totalPaid)}
            </p>
            {hasPenalties && (
              <p className="text-[9px] font-bold uppercase mt-1"
                style={{ color: t.penaltyColor }}>Inclui Multa / Juros de Atraso</p>
            )}
          </div>

          {/* Divider mid */}
          <div className="receipt-dash-divider border-t border-dashed mb-3"
            style={{ borderColor: t.dividerMid }} />

          {/* Parties */}
          <div className="space-y-1.5 mb-3">
            {[{ label: 'Credor', value: creditorName }, { label: 'Cliente', value: clientName }].map(row => (
              <div key={row.label} className="flex items-baseline justify-between">
                <span className="receipt-row-label text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: t.rowLabel }}>{row.label}</span>
                <span className="receipt-row-value text-[11px] font-bold uppercase text-right ml-4"
                  style={{ color: t.rowValue, maxWidth: '60%' }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* Divider mid */}
          <div className="receipt-dash-divider border-t border-dashed mb-3"
            style={{ borderColor: t.dividerMid }} />

          {/* Detail rows */}
          <div className="space-y-2">
            {detailRows.map((row, i) => (
              <div key={i} className="flex items-baseline justify-between">
                <span className="receipt-row-label text-[10px] font-bold uppercase tracking-wider shrink-0"
                  style={{ color: t.rowLabel }}>{row.label}</span>
                <span className={`text-[11px] font-bold text-right ml-4 ${row.highlight ? 'receipt-gold-accent' : 'receipt-row-value'}`}
                  style={{ color: row.highlight ? t.highlightColor : t.rowValue }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          {/* Divider footer */}
          <div className="receipt-dash-divider border-t border-dashed mt-4 mb-3"
            style={{ borderColor: t.dividerFooter }} />

          {/* Footer */}
          <div className="text-center space-y-0.5">
            <p className="receipt-footer-text text-[8px] font-mono font-medium uppercase tracking-wider"
              style={{ color: t.footerAuth }}>
              Auth: {installment.id.split('-').join('').toUpperCase()}
            </p>
            <p className="receipt-footer-text text-[9px] font-black uppercase tracking-[0.2em]"
              style={{ color: t.footerBrand }}>
              Certificado Juros Certo
            </p>
          </div>

        </div>
      </div>

      {/* ── Action buttons ─────────────────────────── */}
      <div className="no-print px-4 py-3 flex gap-2 border-t shrink-0"
        style={{ background: t.actionBg, borderColor: t.actionBorder }}>
        <button
          onClick={handleShare}
          disabled={sharing || !shareBlob}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all active:scale-[0.98] disabled:opacity-60 cursor-pointer"
          style={{ background: t.shareBg, border: t.shareBorder, color: t.shareColor }}
          onMouseEnter={e => { if (!sharing && shareBlob) (e.currentTarget as HTMLButtonElement).style.background = t.shareHover; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = t.shareBg; }}
        >
          {(sharing || !shareBlob) ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />}
          {sharing ? 'Enviando...' : !shareBlob ? 'Gerando...' : 'WhatsApp'}
        </button>
        <button
          onClick={handlePrint}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer"
          style={{ background: isDark ? 'linear-gradient(135deg, #b7902a, #C9A84C)' : 'linear-gradient(135deg, #c9830e, #f0b429)', color: isDark ? '#0a0a0f' : '#fff' }}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.1)')}
          onMouseLeave={e => (e.currentTarget.style.filter = '')}
        >
          <Printer size={15} /> Imprimir
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-3 rounded-xl transition-colors flex items-center justify-center cursor-pointer"
            style={{ color: t.shareColor }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
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
