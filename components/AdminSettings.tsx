
import React, { useState } from 'react';
import { Tenant } from '../types';
import { getSupabase, cleanNumbers, isValidCPF } from '../services/supabase';
import { Save, Building2, Image as ImageIcon, CheckCircle2, RefreshCw, QrCode, Smartphone, ExternalLink, AlertTriangle, MessageCircle, Crown, User } from 'lucide-react';

interface AdminSettingsProps {
    tenant: Tenant;
    onUpdate: (tenant: Tenant) => void;
}

const AdminSettings: React.FC<AdminSettingsProps> = ({ tenant, onUpdate }) => {
    // Company Info
    const [name, setName] = useState(tenant.name);
    const [logoUrl, setLogoUrl] = useState(tenant.logo_url || '');
    
    // Owner Info
    const [ownerName, setOwnerName] = useState(tenant.owner_name || '');
    const [ownerEmail, setOwnerEmail] = useState(tenant.owner_email || '');

    // Pix Info
    const [pixKeyType, setPixKeyType] = useState<'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'>(tenant.pix_key_type || 'CNPJ');
    const [pixKey, setPixKey] = useState(tenant.pix_key || '');
    const [pixName, setPixName] = useState(tenant.pix_name || '');
    const [pixCity, setPixCity] = useState(tenant.pix_city || '');
    const [whatsapp, setWhatsapp] = useState(tenant.support_whatsapp || '');
    
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [fieldError, setFieldError] = useState<string | null>(null);

    const validatePixKey = () => {
        const cleanKey = pixKey.trim();
        if (!cleanKey) return "Chave Pix é obrigatória.";

        if (pixKeyType === 'CPF') {
            if (!isValidCPF(cleanKey)) return "CPF Inválido.";
        }
        if (pixKeyType === 'PHONE') {
            const digits = cleanNumbers(cleanKey);
            if (digits.length < 10) return "Telefone Inválido.";
        }
        if (pixKeyType === 'EMAIL') {
            if (!cleanKey.includes('@')) return "E-mail Inválido.";
        }
        return null;
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setFieldError(null);
        
        const error = validatePixKey();
        if (error) {
            setFieldError(error);
            return;
        }

        setLoading(true);
        const supabase = getSupabase();
        
        // Saneamento final antes do Banco
        let sanitizedPixKey = pixKey.trim();
        if (pixKeyType === 'CPF' || pixKeyType === 'CNPJ' || pixKeyType === 'PHONE') {
            sanitizedPixKey = cleanNumbers(sanitizedPixKey);
            if (pixKeyType === 'PHONE' && !sanitizedPixKey.startsWith('55')) {
                sanitizedPixKey = '55' + sanitizedPixKey;
            }
        }

        const cleanWhatsapp = cleanNumbers(whatsapp);

        if (supabase) {
            const updates = {
                name, 
                logo_url: logoUrl,
                owner_name: ownerName,
                owner_email: ownerEmail,
                pix_key_type: pixKeyType,
                pix_key: sanitizedPixKey,
                pix_name: pixName.toUpperCase().trim(),
                pix_city: pixCity.toUpperCase().trim(),
                support_whatsapp: cleanWhatsapp
            };

            const { error: dbError } = await supabase.from('tenants')
                .update(updates)
                .eq('id', tenant.id);
            
            if (!dbError) {
                onUpdate({ ...tenant, ...updates });
                setSuccess(true);
                setTimeout(() => setSuccess(false), 3000);
            } else {
                setFieldError(`Erro no Banco: ${dbError.message}`);
            }
        }
        setLoading(false);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-12">
            <div className="border-b border-slate-800 pb-6">
                <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Configurações Gerais</h2>
                <p className="text-slate-500 text-xs font-bold uppercase tracking-[0.2em] mt-1">Identidade, Propriedade e Financeiro</p>
            </div>

            <form onSubmit={handleUpdate} className="space-y-8">
                
                {/* 1. DADOS DA EMPRESA */}
                <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] p-8 shadow-2xl">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700/50">
                        <div className="p-3 bg-indigo-900/30 rounded-xl text-indigo-400">
                            <Building2 size={24}/> 
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-white uppercase">Identidade Visual</h3>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <input required type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nome da Empresa" className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-white" />
                        <input type="url" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="URL do Logotipo" className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-white" />
                    </div>
                </div>

                {/* 2. DADOS DO PROPRIETÁRIO (NOVO) */}
                <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] p-8 shadow-2xl">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700/50">
                        <div className="p-3 bg-purple-900/30 rounded-xl text-purple-400">
                            <Crown size={24}/> 
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-white uppercase">Responsável Legal (Owner)</h3>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">Dados oficiais do proprietário da conta</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="relative group">
                             <User className="absolute left-4 top-4 text-slate-500 group-focus-within:text-purple-400 transition-colors" size={18} />
                             <input type="text" value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Nome do Responsável" className="w-full bg-slate-900 border border-slate-700 rounded-2xl pl-12 pr-4 py-4 text-white focus:border-purple-500 outline-none transition-all" />
                        </div>
                        <div className="relative group">
                             <Crown className="absolute left-4 top-4 text-slate-500 group-focus-within:text-purple-400 transition-colors" size={18} />
                             <input type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="E-mail Principal (Owner)" className="w-full bg-slate-900 border border-slate-700 rounded-2xl pl-12 pr-4 py-4 text-white focus:border-purple-500 outline-none transition-all" />
                        </div>
                    </div>
                </div>

                {/* 3. DADOS PIX */}
                <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] p-8 shadow-2xl">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700/50">
                        <div className="p-3 bg-teal-900/30 rounded-xl text-teal-400">
                            <QrCode size={24}/> 
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-white uppercase">Dados de Recebimento (Pix)</h3>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <select value={pixKeyType} onChange={(e) => setPixKeyType(e.target.value as any)} className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-white">
                            <option value="CNPJ">CNPJ</option>
                            <option value="CPF">CPF</option>
                            <option value="EMAIL">E-mail</option>
                            <option value="PHONE">Celular</option>
                            <option value="EVP">Chave Aleatória (EVP)</option>
                        </select>
                        <div className="relative">
                            <input required type="text" value={pixKey} onChange={e => setPixKey(e.target.value)} placeholder="Chave Pix" className={`w-full bg-slate-900 border ${fieldError ? 'border-red-500' : 'border-slate-700'} rounded-2xl p-4 text-white`} />
                            {fieldError && <p className="text-red-500 text-[10px] mt-1 ml-2 font-bold uppercase">{fieldError}</p>}
                        </div>
                        <input required type="text" value={pixName} onChange={e => setPixName(e.target.value)} placeholder="Nome do Beneficiário" className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-white uppercase" />
                        <input required type="text" value={pixCity} onChange={e => setPixCity(e.target.value)} placeholder="Cidade" className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-white uppercase" />
                    </div>
                </div>

                <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] p-8 shadow-2xl">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700/50">
                        <div className="p-3 bg-green-900/30 rounded-xl text-green-400">
                            <MessageCircle size={24}/> 
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-white uppercase">Atendimento</h3>
                        </div>
                    </div>
                    <input type="text" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="WhatsApp do Consultor" className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-white" />
                </div>

                <div className="pt-4 sticky bottom-4 z-10">
                    <button type="submit" disabled={loading} 
                        className={`w-full py-5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-3 shadow-2xl ${
                            success ? 'bg-green-600 text-white' : 'bg-teal-600 hover:bg-teal-500 text-white shadow-teal-900/50'
                        }`}>
                        {loading ? <RefreshCw className="animate-spin" size={18}/> : success ? <><CheckCircle2 size={18}/> Salvo!</> : <><Save size={18}/> Salvar Todas as Alterações</>}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default AdminSettings;
