
import React, { useState } from 'react';
import { Tenant, Profile } from '../types';
import { getSupabase, cleanNumbers, isValidCPF } from '../services/supabase';
import { Save, Building2, CheckCircle2, RefreshCw, QrCode, MessageCircle, Crown, CreditCard, Upload, Activity } from 'lucide-react';
import SubscriptionTab from './SubscriptionTab';

interface AdminSettingsProps {
    tenant: Tenant;
    onUpdate: (tenant: Tenant) => void;
    profile?: Profile;
}

type SettingsSection = 'empresa' | 'responsavel' | 'pix' | 'atendimento' | 'assinatura';

const NAV_ITEMS: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    { id: 'empresa',     label: 'Empresa',      icon: <Building2 size={16} /> },
    { id: 'responsavel', label: 'Responsável',   icon: <Crown size={16} /> },
    { id: 'pix',         label: 'PIX',           icon: <QrCode size={16} /> },
    { id: 'atendimento', label: 'Atendimento',   icon: <MessageCircle size={16} /> },
    { id: 'assinatura',  label: 'Assinatura',    icon: <CreditCard size={16} /> },
];

const TIMEZONE_OPTIONS = [
    { value: 'America/Sao_Paulo',   label: 'Brasília (GMT-3)' },
    { value: 'America/Manaus',      label: 'Manaus (GMT-4)' },
    { value: 'America/Belem',       label: 'Belém (GMT-3)' },
    { value: 'America/Cuiaba',      label: 'Cuiabá (GMT-4)' },
    { value: 'America/Rio_Branco',  label: 'Rio Branco (GMT-5)' },
    { value: 'America/Noronha',     label: 'Fernando de Noronha (GMT-2)' },
    { value: 'America/New_York',    label: 'Nova York (GMT-5)' },
    { value: 'Europe/Lisbon',       label: 'Lisboa (GMT+0)' },
];

const AdminSettings: React.FC<AdminSettingsProps> = ({ tenant, onUpdate, profile }) => {
    const [activeSection, setActiveSection] = useState<SettingsSection>('empresa');

    // Company Info
    const [name, setName] = useState(tenant.name);
    const [logoUrl, setLogoUrl] = useState(tenant.logo_url || '');
    const [logoUploading, setLogoUploading] = useState(false);
    const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

    // Owner Info
    const [ownerName, setOwnerName] = useState(tenant.owner_name || '');
    const [ownerEmail, setOwnerEmail] = useState(tenant.owner_email || '');

    // Pix Info
    const [pixKeyType, setPixKeyType] = useState<'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'>(tenant.pix_key_type || 'CNPJ');
    const [pixKey, setPixKey] = useState(tenant.pix_key || '');
    const [pixName, setPixName] = useState(tenant.pix_name || '');
    const [pixCity, setPixCity] = useState(tenant.pix_city || '');
    const [whatsapp, setWhatsapp] = useState(tenant.support_whatsapp || '');
    const [timezone, setTimezone] = useState(tenant.timezone || 'America/Sao_Paulo');

    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [fieldError, setFieldError] = useState<string | null>(null);

    const handleLogoUpload = async (file: File) => {
        const supabase = getSupabase();
        if (!supabase) return;
        setLogoUploading(true);
        setLogoUploadError(null);
        try {
            const ext = file.name.split('.').pop();
            const path = `logos/${crypto.randomUUID()}.${ext}`;
            const { error } = await supabase.storage
                .from('profile-photos')
                .upload(path, file, { upsert: true });
            if (error) throw error;
            const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
            setLogoUrl(data.publicUrl);
        } catch {
            setLogoUploadError('Erro ao enviar logo. Tente novamente.');
        } finally {
            setLogoUploading(false);
        }
    };

    const validatePixKey = () => {
        const cleanKey = pixKey.trim();
        if (!cleanKey) return "Chave Pix é obrigatória.";
        if (pixKeyType === 'CPF' && !isValidCPF(cleanKey)) return "CPF Inválido.";
        if (pixKeyType === 'PHONE' && cleanNumbers(cleanKey).length < 10) return "Telefone Inválido.";
        if (pixKeyType === 'EMAIL' && !cleanKey.includes('@')) return "E-mail Inválido.";
        return null;
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setFieldError(null);

        const error = validatePixKey();
        if (error) { setFieldError(error); return; }

        setLoading(true);
        const supabase = getSupabase();

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
                support_whatsapp: cleanWhatsapp,
                timezone,
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
        <div className="max-w-5xl mx-auto animate-fade-in pb-16">
            {/* Page header */}
            <div className="border-b border-[color:var(--border-subtle)] pb-6 mb-8">
                <h2 className="type-title uppercase text-[color:var(--text-primary)]">Configurações</h2>
                <p className="type-label text-[color:var(--text-muted)] mt-1">Identidade, financeiro e assinatura</p>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-[color:var(--border-subtle)] overflow-x-auto mb-8">
                {NAV_ITEMS.map(item => (
                    <button
                        key={item.id}
                        onClick={() => setActiveSection(item.id)}
                        className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                            activeSection === item.id
                                ? 'border-teal-400 text-[color:var(--text-primary)]'
                                : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            <form onSubmit={handleUpdate} key={activeSection}>

                        {/* EMPRESA */}
                        {activeSection === 'empresa' && (
                            <div className="space-y-8">
                                <div>
                                    <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Empresa</h3>
                                    <p className="text-sm text-[color:var(--text-muted)]">Nome e logotipo exibidos na plataforma e nos comprovantes.</p>
                                </div>
                                <div className="border-t border-[color:var(--border-subtle)] pt-6 space-y-5">
                                    <div>
                                        <label className="block type-label text-[color:var(--text-muted)] mb-2">Nome da Empresa</label>
                                        <input
                                            required
                                            type="text"
                                            value={name}
                                            onChange={e => setName(e.target.value)}
                                            placeholder="Ex: Crédito Certo"
                                            className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-colors"
                                        />
                                        <p className="text-[color:var(--text-muted)] text-xs mt-1.5">Este nome aparece nos comprovantes de pagamento enviados aos devedores.</p>
                                    </div>
                                    <div>
                                        <label className="block type-label text-[color:var(--text-muted)] mb-2">Logotipo</label>
                                        <div className="flex items-center gap-4">
                                            <label className="cursor-pointer flex-1">
                                                <div className="flex items-center gap-3 bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] hover:border-teal-500 rounded-xl px-4 py-3 transition-colors">
                                                    {logoUploading
                                                        ? <Activity className="text-teal-400 animate-spin shrink-0" size={16} />
                                                        : <Upload className="text-[color:var(--text-muted)] shrink-0" size={16} />}
                                                    <span className="text-sm text-[color:var(--text-muted)]">
                                                        {logoUploading ? 'Enviando...' : logoUrl ? 'Trocar logotipo' : 'Selecionar logotipo'}
                                                    </span>
                                                </div>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    disabled={logoUploading}
                                                    onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }}
                                                />
                                            </label>
                                            {logoUrl && (
                                                <img
                                                    src={logoUrl}
                                                    alt="Logo preview"
                                                    className="w-12 h-12 rounded-xl object-cover border border-[color:var(--border-subtle)] shrink-0 bg-slate-800"
                                                />
                                            )}
                                        </div>
                                        {logoUploadError && <p className="text-red-400 text-xs mt-1.5">{logoUploadError}</p>}
                                    </div>
                                    <div>
                                        <label className="block type-label text-[color:var(--text-muted)] mb-2">Fuso Horário</label>
                                        <select
                                            value={timezone}
                                            onChange={e => setTimezone(e.target.value)}
                                            className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-colors"
                                        >
                                            {TIMEZONE_OPTIONS.map(tz => (
                                                <option key={tz.value} value={tz.value}>{tz.label}</option>
                                            ))}
                                        </select>
                                        <p className="text-[color:var(--text-muted)] text-xs mt-1.5">Define o fuso horário usado nos relatórios e dashboards.</p>
                                    </div>
                                </div>
                                <SaveButton loading={loading} success={success} />
                            </div>
                        )}

                        {/* RESPONSÁVEL */}
                        {activeSection === 'responsavel' && (
                            <div className="space-y-8">
                                <div>
                                    <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Responsável</h3>
                                    <p className="text-sm text-[color:var(--text-muted)]">Dados oficiais do proprietário da conta.</p>
                                </div>
                                <div className="border-t border-[color:var(--border-subtle)] pt-6 space-y-5">
                                    <div>
                                        <label className="block type-label text-[color:var(--text-muted)] mb-2">Nome Legal</label>
                                        <input
                                            type="text"
                                            value={ownerName}
                                            onChange={e => setOwnerName(e.target.value)}
                                            placeholder="Nome completo do responsável"
                                            className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="block type-label text-[color:var(--text-muted)] mb-2">E-mail Owner</label>
                                        <input
                                            type="email"
                                            value={ownerEmail}
                                            onChange={e => setOwnerEmail(e.target.value)}
                                            placeholder="email@empresa.com"
                                            className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-colors"
                                        />
                                    </div>
                                </div>
                                <SaveButton loading={loading} success={success} />
                            </div>
                        )}

                        {/* PIX */}
                        {activeSection === 'pix' && (
                            <div className="space-y-8">
                                <div>
                                    <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">PIX</h3>
                                    <p className="text-sm text-[color:var(--text-muted)]">Dados de recebimento exibidos no QR Code de pagamento.</p>
                                </div>
                                <div className="border-t border-[color:var(--border-subtle)] pt-6 space-y-5">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div>
                                            <label className="block type-label text-[color:var(--text-muted)] mb-2">Tipo de Chave</label>
                                            <select
                                                value={pixKeyType}
                                                onChange={e => setPixKeyType(e.target.value as any)}
                                                className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-colors"
                                            >
                                                <option value="CNPJ">CNPJ</option>
                                                <option value="CPF">CPF</option>
                                                <option value="EMAIL">E-mail</option>
                                                <option value="PHONE">Celular</option>
                                                <option value="EVP">Chave Aleatória (EVP)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block type-label text-[color:var(--text-muted)] mb-2">Chave PIX</label>
                                            <input
                                                required
                                                type="text"
                                                value={pixKey}
                                                onChange={e => setPixKey(e.target.value)}
                                                placeholder="Sua chave PIX"
                                                className={`w-full bg-[color:var(--bg-base)] border ${fieldError ? 'border-red-500' : 'border-[color:var(--border-subtle)]'} rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-colors`}
                                            />
                                            {fieldError && <p className="text-red-400 text-xs mt-1.5">{fieldError}</p>}
                                        </div>
                                        <div>
                                            <label className="block type-label text-[color:var(--text-muted)] mb-2">Nome do Beneficiário</label>
                                            <input
                                                required
                                                type="text"
                                                value={pixName}
                                                onChange={e => setPixName(e.target.value)}
                                                placeholder="NOME COMPLETO OU RAZAO SOCIAL"
                                                className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm uppercase focus:border-teal-500 outline-none transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block type-label text-[color:var(--text-muted)] mb-2">Cidade</label>
                                            <input
                                                required
                                                type="text"
                                                value={pixCity}
                                                onChange={e => setPixCity(e.target.value)}
                                                placeholder="SAO PAULO"
                                                className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm uppercase focus:border-teal-500 outline-none transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <SaveButton loading={loading} success={success} />
                            </div>
                        )}

                        {/* ATENDIMENTO */}
                        {activeSection === 'atendimento' && (
                            <div className="space-y-8">
                                <div>
                                    <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Atendimento</h3>
                                    <p className="text-sm text-[color:var(--text-muted)]">Canal de suporte exibido nos comprovantes e comunicações.</p>
                                </div>
                                <div className="border-t border-[color:var(--border-subtle)] pt-6 space-y-5">
                                    <div>
                                        <label className="block type-label text-[color:var(--text-muted)] mb-2">WhatsApp do Consultor</label>
                                        <input
                                            type="text"
                                            value={whatsapp}
                                            onChange={e => setWhatsapp(e.target.value)}
                                            placeholder="5585999999999"
                                            className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-colors"
                                        />
                                        <p className="text-[color:var(--text-muted)] text-xs mt-1.5">Número com código do país. Ex: 5585912345678</p>
                                    </div>
                                </div>
                                <SaveButton loading={loading} success={success} />
                            </div>
                        )}

                        {/* ASSINATURA — sem botão salvar, delegado ao SubscriptionTab */}
                        {activeSection === 'assinatura' && (
                            <div className="space-y-8">
                                <div>
                                    <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Assinatura</h3>
                                    <p className="text-sm text-[color:var(--text-muted)]">Plano atual, faturamento e gerenciamento da assinatura.</p>
                                </div>
                                <div className="border-t border-[color:var(--border-subtle)] pt-6">
                                    <SubscriptionTab
                                        tenant={tenant}
                                        adminEmail={profile?.email || tenant.owner_email}
                                    />
                                </div>
                            </div>
                        )}

            </form>
        </div>
    );
};

const SaveButton: React.FC<{ loading: boolean; success: boolean }> = ({ loading, success }) => (
    <div className="flex justify-end pt-2">
        <button
            type="submit"
            disabled={loading}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                success
                    ? 'bg-green-600 text-white'
                    : 'bg-[color:var(--accent-brass)] hover:bg-[color:var(--accent-brass-strong)] text-[color:var(--text-on-accent)]'
            }`}
        >
            {loading
                ? <><RefreshCw className="animate-spin" size={15} /> Salvando...</>
                : success
                    ? <><CheckCircle2 size={15} /> Salvo!</>
                    : <><Save size={15} /> Salvar</>}
        </button>
    </div>
);

export default AdminSettings;
