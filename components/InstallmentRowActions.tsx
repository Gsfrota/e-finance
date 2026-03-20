
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LoanInstallment } from '../types';
import { MoreVertical, CheckCircle2, Banknote, Pencil, Receipt, FileText, Percent } from 'lucide-react';

interface InstallmentRowActionsProps {
  installment: LoanInstallment;
  onPay: (installment: LoanInstallment) => void;
  onRefinance: (installment: LoanInstallment) => void;
  onEdit: (installment: LoanInstallment) => void;
  onInterestOnly?: (installment: LoanInstallment) => void;
}

const InstallmentRowActions: React.FC<InstallmentRowActionsProps> = ({
  installment,
  onPay,
  onRefinance,
  onEdit,
  onInterestOnly
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Fecha ao rolar a página para evitar menu flutuando solto
  useEffect(() => {
    const handleScroll = () => { if(isOpen) setIsOpen(false); };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen]);

  // Fecha ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isOpen && buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        // Verifica se o clique não foi dentro do menu (que está no portal)
        const menuEl = document.getElementById(`action-menu-${installment.id}`);
        if (menuEl && !menuEl.contains(e.target as Node)) {
            setIsOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, installment.id]);

  const toggleMenu = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (buttonRef.current) {
          const rect = buttonRef.current.getBoundingClientRect();
          // Calcula posição: Alinhado à direita do botão, um pouco abaixo
          setCoords({
              top: rect.bottom + 5 + window.scrollY,
              left: rect.right - 192 + window.scrollX // 192px é a largura w-48
          });
      }
      setIsOpen(!isOpen);
  };

  const MenuContent = (
    <div 
        id={`action-menu-${installment.id}`}
        className="fixed z-[9999] w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-fade-in-down"
        style={{ top: coords.top, left: coords.left }}
        onClick={(e) => e.stopPropagation()}
    >
        <div className="py-1">
        
        {/* OPÇÕES PARA PENDENTE */}
        {installment.status !== 'paid' && (
            <>
                <button
                    onClick={() => { onPay(installment); setIsOpen(false); }}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-emerald-900/10 group transition-colors border-b border-slate-700/50"
                >
                    <CheckCircle2 size={14} className="text-emerald-500 group-hover:scale-110 transition-transform"/>
                    <span className="type-label text-emerald-400">Baixar (Pagar)</span>
                </button>

                <button
                    onClick={() => { onRefinance(installment); setIsOpen(false); }}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-purple-900/10 group transition-colors border-b border-slate-700/50"
                >
                    <Banknote size={14} className="text-purple-400 group-hover:scale-110 transition-transform"/>
                    <span className="type-label text-purple-300">Refinanciar</span>
                </button>

                {onInterestOnly && (
                    <button
                        onClick={() => { onInterestOnly(installment); setIsOpen(false); }}
                        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[color:var(--accent-caution-bg)] group transition-colors border-b border-slate-700/50"
                    >
                        <Percent size={14} className="text-[color:var(--accent-caution)] group-hover:scale-110 transition-transform"/>
                        <span className="type-label text-[color:var(--accent-caution)]">Pagar Só Juros</span>
                    </button>
                )}
            </>
        )}

        {/* OPÇÕES PARA PAGO */}
        {installment.status === 'paid' && (
             <button
                onClick={() => { onPay(installment); setIsOpen(false); }} // Reutiliza onPay para abrir modo Recibo
                className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/5 group transition-colors border-b border-slate-700/50"
            >
                <FileText size={14} className="text-white group-hover:scale-110 transition-transform"/>
                <span className="type-label text-white">Ver Comprovante</span>
            </button>
        )}

        {/* OPÇÕES GERAIS */}
        <button
            onClick={() => { onEdit(installment); setIsOpen(false); }}
            className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-sky-900/10 group transition-colors"
        >
            <Pencil size={14} className="text-sky-400 group-hover:scale-110 transition-transform"/>
            <span className="type-label text-sky-300">Editar Dados</span>
        </button>
        </div>
    </div>
  );

  return (
    <>
      <button 
        ref={buttonRef}
        onClick={toggleMenu}
        className={`p-2 rounded-lg transition-all ${isOpen ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-800 hover:text-white'}`}
      >
        <MoreVertical size={16} />
      </button>
      {isOpen && createPortal(MenuContent, document.body)}
    </>
  );
};

export default InstallmentRowActions;
