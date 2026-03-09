
import React, { useState } from 'react';
import { Tenant, Profile } from '../types';
import { getSupabase, cleanNumbers, isValidCPF } from '../services/supabase';
import { Save, Building2, CheckCircle2, RefreshCw, QrCode, MessageCircle, Crown, User, CreditCard } from 'lucide-react';
import SubscriptionTab from './SubscriptionTab';

interface AdminSettingsProps {
    tenant: Tenant;
    onUpdate: (tenant: Tenant) => void;
    profile?: Profile;
}

type SettingsTab = 'company' | 'subscription';

const AdminSettings: React.FC<AdminSettingsProps> = ({ tenant, onUpdate, profile }) => {
    const [activeTab, setActiveTab] = useState<SettingsTab>('company');

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
            <div className="border-b border-[color:var(--border-subtle)] pb-6">
                <h2 className="text-3xl font-black text-[color:var(--text-primary)] uppercase tracking-tighter">Configurações</h2>
                <p className="text-[color:var(--text-muted)] text-xs font-bold uppercase tracking-[0.2em] mt-1">Identidade, Propriedade, Financeiro e Assinatura</p>
            </div>

            {/* Abas */}
            <div className="flex gap-2 bg-[color:var(--bg-elevated)] p-1.5 rounded-2xl border border-[color:var(--border-subtle)]">
                <button
                    onClick={() => setActiveTab('company')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
                        activeTab === 'company'
                            ? 'bg-[color:var(--bg-strong)] text-[color:var(--text-primary)] shadow'
                            : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'
                    }`}
                >
                    <Building2 size={14} /> Empresa & Financeiro
                </button>
                <button
                    onClick={() => setActiveTab('subscription')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
                        activeTab === 'subscription'
                            ? 'bg-[color:var(--bg-strong)] text-[color:var(--text-primary)] shadow'
                            : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'
                    }`}
                >
                    <CreditCard size={14} /> Assinatura
                </button>
            </div>

            {/* Conteúdo da aba Empresa */}
            {activeTab === 'company' && (
                <form onSubmit={handleUpdate} className="space-y-8">

                    {/* 1. DADOS DA EMPRESA */}
                    <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-2xl">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[color:var(--border-subtle)]">
                            <div className="p-3 bg-indigo-900/30 rounded-xl text-indigo-400">
                                <Building2 size={24}/>
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-[color:var(--text-primary)] uppercase">Identidade Visual</h3>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <input required type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nome da Empresa" className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)]" />
                            <input type="url" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="URL do Logotipo" className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)]" />
                        </div>
                    </div>

                    {/* 2. DADOS DO PROPRIETÁRIO */}
                    <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-2xl">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[color:var(--border-subtle)]">
                            <div className="p-3 bg-purple-900/30 rounded-xl text-purple-400">
                                <Crown size={24}/>
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-[color:var(--text-primary)] uppercase">Responsável Legal</h3>
                                <p className="text-[10px] text-[color:var(--text-muted)] font-bold uppercase tracking-wide">Dados oficiais do proprietário da conta</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="relative group">
                                 <User className="absolute left-4 top-4 text-[color:var(--text-muted)] group-focus-within:text-purple-400 transition-colors" size={18} />
                                 <input type="text" value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Nome do Responsável" className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl pl-12 pr-4 py-4 text-[color:var(--text-primary)] focus:border-purple-500 outline-none transition-all" />
                            </div>
                            <div className="relative group">
                                 <Crown className="absolute left-4 top-4 text-[color:var(--text-muted)] group-focus-within:text-purple-400 transition-colors" size={18} />
                                 <input type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="E-mail Principal (Owner)" className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl pl-12 pr-4 py-4 text-[color:var(--text-primary)] focus:border-purple-500 outline-none transition-all" />
                            </div>
                        </div>
                    </div>

                    {/* 3. DADOS PIX */}
                    <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-2xl">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[color:var(--border-subtle)]">
                            <div className="p-3 bg-teal-900/30 rounded-xl text-teal-400">
                                <QrCode size={24}/>
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-[color:var(--text-primary)] uppercase">Dados de Recebimento (Pix)</h3>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <select value={pixKeyType} onChange={(e) => setPixKeyType(e.target.value as any)} className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)]">
                                <option value="CNPJ">CNPJ</option>
                                <option value="CPF">CPF</option>
                                <option value="EMAIL">E-mail</option>
                                <option value="PHONE">Celular</option>
                                <option value="EVP">Chave Aleatória (EVP)</option>
                            </select>
                            <div className="relative">
                                <input required type="text" value={pixKey} onChange={e => setPixKey(e.target.value)} placeholder="Chave Pix" className={`w-full bg-[color:var(--bg-base)] border ${fieldError ? 'border-red-500' : 'border-[color:var(--border-subtle)]'} rounded-2xl p-4 text-[color:var(--text-primary)]`} />
                                {fieldError && <p className="text-red-500 text-[10px] mt-1 ml-2 font-bold uppercase">{fieldError}</p>}
                            </div>
                            <input required type="text" value={pixName} onChange={e => setPixName(e.target.value)} placeholder="Nome do Beneficiário" className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)] uppercase" />
                            <input required type="text" value={pixCity} onChange={e => setPixCity(e.target.value)} placeholder="Cidade" className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)] uppercase" />
                        </div>
                    </div>

                    <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-2xl">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[color:var(--border-subtle)]">
                            <div className="p-3 bg-green-900/30 rounded-xl text-green-400">
                                <MessageCircle size={24}/>
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-[color:var(--text-primary)] uppercase">Atendimento</h3>
                            </div>
                        </div>
                        <input type="text" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="WhatsApp do Consultor" className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)]" />
                    </div>

                    <div className="pt-4 sticky bottom-4 z-10">
                        <button type="submit" disabled={loading}
                            className={`w-full py-5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-3 shadow-2xl ${
                                success ? 'bg-green-600 text-white' : 'bg-[color:var(--accent-brass)] hover:bg-[color:var(--accent-brass-strong)] text-[#17120b]'
                            }`}>
                            {loading ? <RefreshCw className="animate-spin" size={18}/> : success ? <><CheckCircle2 size={18}/> Salvo!</> : <><Save size={18}/> Salvar Todas as Alterações</>}
                        </button>
                    </div>
                </form>
            )}

            {/* Conteúdo da aba Assinatura */}
            {activeTab === 'subscription' && (
                <SubscriptionTab
                    tenant={tenant}
                    adminEmail={profile?.email || tenant.owner_email}
                />
            )}
        </div>
    );
};

export default AdminSettings;
