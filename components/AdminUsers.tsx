
import React, { useEffect, useState } from 'react';
import { getSupabase, logError, parseSupabaseError, isValidCPF } from '../services/supabase';
import { Profile, UserRole, Tenant, Invite } from '../types';
import { User, PlusCircle, Search, X, DollarSign, Activity, Users, CreditCard, Pencil, AlertTriangle, FileSearch, RefreshCw, Crown, Shield, Clipboard, Check, Key, Mail, Phone, Briefcase, Send, Trash2, Hourglass, UserPlus, MapPin, Upload, CheckCircle2, ArrowLeft } from 'lucide-react';

// View Model para unificar a exibição
type DisplayUser = {
  id: string;
  isInvite: boolean;
  inviteId?: string;
  inviteCode?: string;
  fullName: string;
  email: string;
  role: UserRole;
  status: 'REGISTRADO' | 'PENDENTE';
  createdAt: string;
  cpf?: string;
  photo_url?: string;
  phone_number?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
};

const maskCPF = (v: string) =>
  v.replace(/\D/g, '').slice(0, 11)
   .replace(/(\d{3})(\d)/, '$1.$2')
   .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
   .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');

interface AdminUsersProps {
  onViewDashboard: (userId: string) => void;
}

const AdminUsers: React.FC<AdminUsersProps> = ({ onViewDashboard }) => {
  const [displayUsers, setDisplayUsers] = useState<DisplayUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'investor' | 'debtor' | 'pending'>('all');

  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);

  const [usersSubView, setUsersSubView] = useState<'list' | 'invite' | 'edit'>('list');
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<DisplayUser | null>(null);

  const [inviteForm, setInviteForm] = useState({
    full_name: '', email: '', phone_number: '', role: 'debtor' as UserRole,
    cpf: '', cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '', photo_url: '',
  });
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const [cpfError, setCpfError] = useState<string | null>(null);

  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedInviteCode, setCopiedInviteCode] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [clientCreated, setClientCreated] = useState(false);

  const [editForm, setEditForm] = useState({
    full_name: '', role: 'investor' as UserRole, cpf: '',
    phone_number: '', cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '', photo_url: '',
  });
  const [editCepLoading, setEditCepLoading] = useState(false);
  const [editCepError, setEditCepError] = useState<string | null>(null);
  const [editCpfError, setEditCpfError] = useState<string | null>(null);
  const [editUploading, setEditUploading] = useState(false);
  const [editUploadError, setEditUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchUsersAndInvites = async () => {
    if (displayUsers.length === 0) setLoading(true);
    setErrorMessage(null);
    try {
        const supabase = getSupabase();
        if (!supabase) throw new Error("Instância Supabase ausente.");

        const { data: { user: authUser } } = await supabase.auth.getUser();

        const { data: adminProfile, error: profError } = await supabase
            .from('profiles')
            .select(`*, tenants!profiles_tenant_id_fkey (*)`)
            .eq('auth_user_id', authUser?.id)
            .single();

        if (profError) throw profError;
        setCurrentTenant(adminProfile.tenants as any);
        const tenantId = adminProfile.tenant_id;

        const [profilesRes, invitesRes] = await Promise.all([
            supabase.from('profiles').select('*').eq('tenant_id', tenantId),
            supabase.from('invites').select('*').eq('tenant_id', tenantId).eq('status', 'pending')
        ]);

        if (profilesRes.error) throw profilesRes.error;
        if (invitesRes.error) throw invitesRes.error;

        const registered: DisplayUser[] = (profilesRes.data || []).map(p => ({
            id: p.id,
            isInvite: false,
            fullName: p.full_name,
            email: p.email,
            role: p.role,
            status: 'REGISTRADO',
            createdAt: p.created_at,
            cpf: p.cpf || undefined,
            photo_url: p.photo_url || undefined,
            phone_number: p.phone_number || undefined,
            cep: p.cep || undefined,
            logradouro: p.logradouro || undefined,
            numero: p.numero || undefined,
            bairro: p.bairro || undefined,
            cidade: p.cidade || undefined,
            uf: p.uf || undefined,
        }));

        const pending: DisplayUser[] = (invitesRes.data || []).map(i => ({
            id: i.id,
            isInvite: true,
            inviteId: i.id,
            inviteCode: i.code,
            fullName: i.full_name || 'Convidado',
            email: i.email || 'E-mail pendente',
            role: i.role as UserRole,
            status: 'PENDENTE',
            createdAt: i.created_at,
            cpf: undefined,
            photo_url: undefined,
        }));

        const allUsers = [...registered, ...pending].sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setDisplayUsers(allUsers);

    } catch (err) {
        logError("FetchUsersAndInvites", err);
        setErrorMessage(parseSupabaseError(err));
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => { fetchUsersAndInvites(); }, []);

  const handleCepLookup = async (digits: string) => {
    if (digits.length !== 8) return;
    setCepLoading(true);
    setCepError(null);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const d = await res.json();
      if (d.erro) { setCepError('CEP não encontrado.'); return; }
      setInviteForm(p => ({
        ...p,
        logradouro: d.logradouro || '',
        bairro: d.bairro || '',
        cidade: d.localidade || '',
        uf: d.uf || '',
      }));
    } catch {
      setCepError('Erro ao consultar CEP.');
    } finally {
      setCepLoading(false);
    }
  };

  const handlePhotoUpload = async (file: File) => {
    const supabase = getSupabase();
    if (!supabase) return;
    setUploading(true);
    setUploadError(null);
    try {
      const ext = file.name.split('.').pop();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from('profile-photos')
        .upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
      setInviteForm(f => ({ ...f, photo_url: data.publicUrl }));
    } catch {
      setUploadError('Erro ao enviar foto. Tente novamente.');
    } finally {
      setUploading(false);
    }
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setCpfError(null);

    const cpfDigits = inviteForm.cpf.replace(/\D/g, '');
    if (cpfDigits && !isValidCPF(cpfDigits)) {
      setCpfError('CPF inválido. Verifique os dígitos informados.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase não inicializado.');
      const toNull = (v: string) => v.trim() || null;
      const { error } = await supabase.rpc('create_client_direct', {
        p_full_name:    inviteForm.full_name,
        p_email:        toNull(inviteForm.email),
        p_role:         inviteForm.role,
        p_phone_number: toNull(inviteForm.phone_number),
        p_cpf:          toNull(cpfDigits),
        p_photo_url:    toNull(inviteForm.photo_url),
      });
      if (error) throw error;
      setClientCreated(true);
      fetchUsersAndInvites();
    } catch (err: any) {
      logError('CreateClientDirect', err);
      setErrorMessage(parseSupabaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteInvite = async (inviteId: string) => {
      if (!window.confirm("Tem certeza que deseja cancelar este convite?")) return;

      const supabase = getSupabase();
      if (!supabase) return;

      const { error } = await supabase.from('invites').delete().eq('id', inviteId);
      if (error) {
          setErrorMessage(parseSupabaseError(error));
      } else {
          fetchUsersAndInvites();
      }
  };

  const resetInviteModal = () => {
    setInviteForm({ full_name: '', email: '', phone_number: '', role: 'debtor', cpf: '', cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '', photo_url: '' });
    setGeneratedCode(null);
    setClientCreated(false);
    setErrorMessage(null);
    setCpfError(null);
    setCepError(null);
    setUploadError(null);
    setSubmitting(false);
    fetchUsersAndInvites();
  };

  const handleSendLink = (code: string) => {
    const inviteLink = `${window.location.origin}${window.location.pathname}?convite=${code}`;
    navigator.clipboard.writeText(inviteLink);
    setCopiedInviteCode(code);
    setTimeout(() => setCopiedInviteCode(null), 2000);
  };

  const handleEditCepLookup = async (digits: string) => {
    if (digits.length !== 8) return;
    setEditCepLoading(true);
    setEditCepError(null);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const d = await res.json();
      if (d.erro) { setEditCepError('CEP não encontrado.'); return; }
      setEditForm(p => ({
        ...p,
        logradouro: d.logradouro || p.logradouro,
        bairro: d.bairro || p.bairro,
        cidade: d.localidade || p.cidade,
        uf: d.uf || p.uf,
      }));
    } catch {
      setEditCepError('Erro ao consultar CEP.');
    } finally {
      setEditCepLoading(false);
    }
  };

  const handleEditPhotoUpload = async (file: File) => {
    const supabase = getSupabase();
    if (!supabase) return;
    setEditUploading(true);
    setEditUploadError(null);
    try {
      const ext = file.name.split('.').pop();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('profile-photos').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
      setEditForm(f => ({ ...f, photo_url: data.publicUrl }));
    } catch {
      setEditUploadError('Erro ao enviar foto. Tente novamente.');
    } finally {
      setEditUploading(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForEdit) return;
    setEditCpfError(null);
    const cleanCpf = (editForm.cpf || '').replace(/\D/g, '');
    if (cleanCpf && !isValidCPF(cleanCpf)) {
      setEditCpfError('CPF inválido. Verifique os dígitos informados.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
        const supabase = getSupabase();
        const toNull = (v: string) => v.trim() || null;
        const updates = {
            full_name: editForm.full_name,
            role: editForm.role,
            cpf: toNull(cleanCpf),
            phone_number: toNull(editForm.phone_number),
            cep: toNull(editForm.cep.replace(/\D/g, '')),
            logradouro: toNull(editForm.logradouro),
            numero: toNull(editForm.numero),
            bairro: toNull(editForm.bairro),
            cidade: toNull(editForm.cidade),
            uf: toNull(editForm.uf),
            photo_url: toNull(editForm.photo_url),
            updated_at: new Date().toISOString(),
        };
        const { error } = await supabase!.from('profiles').update(updates).eq('id', selectedUserForEdit.id);
        if (error) throw error;
        fetchUsersAndInvites();
        setUsersSubView('list');
        setSelectedUserForEdit(null);
    } catch (err: any) {
        logError("UpdateUser", err);
        setErrorMessage(parseSupabaseError(err));
    } finally {
        setSubmitting(false);
    }
  };

  const filteredUsers = displayUsers.filter(u => {
    const matchesSearch = u.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || u.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === 'all' || u.role === activeTab || (activeTab === 'pending' && u.status === 'PENDENTE');
    return matchesSearch && matchesTab;
  });

  const counts = {
      all: displayUsers.length,
      investor: displayUsers.filter(u => u.role === 'investor' && u.status === 'REGISTRADO').length,
      debtor: displayUsers.filter(u => u.role === 'debtor' && u.status === 'REGISTRADO').length,
      pending: displayUsers.filter(u => u.status === 'PENDENTE').length,
  };

  if (usersSubView === 'invite') {
    return (
      <div className="flex h-full flex-col bg-[color:var(--bg-elevated)]">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-5 py-5 shrink-0">
          <button
            onClick={() => { setUsersSubView('list'); resetInviteModal(); }}
            className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors"
          >
            <ArrowLeft size={20}/>
          </button>
          <h3 className="text-xl font-black text-[color:var(--text-primary)] uppercase tracking-tighter">Cadastrar Cliente</h3>
        </div>
        {/* Error */}
        {errorMessage && (
          <div className="mx-5 mt-4 bg-red-900/20 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
            <AlertTriangle size={14}/> {errorMessage}
          </div>
        )}
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 pb-8">
          {clientCreated ? (
            <div className="flex flex-col items-center gap-5 py-8 text-center">
              <CheckCircle2 size={48} className="text-teal-400" />
              <p className="font-black text-lg text-[color:var(--text-primary)]">Cliente cadastrado!</p>
              <p className="text-sm text-[color:var(--text-muted)]">
                O perfil foi criado. Você pode gerar um link de acesso depois, se necessário.
              </p>
              <button
                onClick={() => { setUsersSubView('list'); resetInviteModal(); }}
                className="w-full py-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-black uppercase tracking-widest"
              >
                Fechar
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreateClient} className="space-y-3 sm:space-y-5">
              {/* Seção 1 — Identificação */}
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)]">Identificação</p>
                <div className="relative"><User className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} /><input required type="text" value={inviteForm.full_name} onChange={e => setInviteForm({...inviteForm, full_name: e.target.value})} placeholder="Nome Completo" className="w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl text-[color:var(--text-primary)]" /></div>
                <div className="relative"><Mail className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} /><input type="email" value={inviteForm.email} onChange={e => setInviteForm({...inviteForm, email: e.target.value})} placeholder="E-mail (Opcional)" className="w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl text-[color:var(--text-primary)]" /></div>
                <div className="relative"><Phone className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} /><input type="tel" value={inviteForm.phone_number} onChange={e => setInviteForm({...inviteForm, phone_number: e.target.value})} placeholder="Telefone (Opcional)" className="w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl text-[color:var(--text-primary)]" /></div>
                <div className="relative"><Briefcase className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} /><select required value={inviteForm.role} onChange={e => setInviteForm({...inviteForm, role: e.target.value as UserRole})} className="w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl appearance-none text-[color:var(--text-primary)]"><option value="debtor">Devedor</option><option value="investor">Investidor</option></select></div>
              </div>
              {/* Seção 2 — Documento */}
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)]">Documento</p>
                <div className="relative">
                  <Key className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} />
                  <input
                    type="text"
                    value={inviteForm.cpf}
                    onChange={e => {
                      const masked = maskCPF(e.target.value);
                      setInviteForm({...inviteForm, cpf: masked});
                      setCpfError(null);
                    }}
                    placeholder="CPF (Opcional)"
                    className={`w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl text-[color:var(--text-primary)] ${cpfError ? 'border border-red-500' : ''}`}
                  />
                </div>
                {cpfError && <p className="text-red-400 text-xs pl-1">{cpfError}</p>}
              </div>
              {/* Seção 3 — Endereço */}
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)]">Endereço <span className="text-[color:var(--text-faint)]">(Opcional)</span></p>
                <div className="relative">
                  <MapPin className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} />
                  <input
                    type="text"
                    value={inviteForm.cep}
                    onChange={e => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
                      const formatted = digits.length > 5 ? `${digits.slice(0,5)}-${digits.slice(5)}` : digits;
                      setInviteForm({...inviteForm, cep: formatted});
                      setCepError(null);
                      if (digits.length === 8) handleCepLookup(digits);
                    }}
                    placeholder="CEP"
                    className="w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl text-[color:var(--text-primary)]"
                  />
                  {cepLoading && <Activity className="absolute right-4 top-4 text-teal-500 animate-spin" size={18} />}
                </div>
                {cepError && <p className="text-red-400 text-xs pl-1">{cepError}</p>}
                <input type="text" value={inviteForm.logradouro} onChange={e => setInviteForm({...inviteForm, logradouro: e.target.value})} placeholder="Logradouro" className="w-full bg-[color:var(--bg-base)] p-4 rounded-2xl text-[color:var(--text-primary)]" />
                <input type="text" value={inviteForm.numero} onChange={e => setInviteForm({...inviteForm, numero: e.target.value})} placeholder="Número" className="w-full bg-[color:var(--bg-base)] p-4 rounded-2xl text-[color:var(--text-primary)]" />
                <input type="text" value={inviteForm.bairro} onChange={e => setInviteForm({...inviteForm, bairro: e.target.value})} placeholder="Bairro" className="w-full bg-[color:var(--bg-base)] p-4 rounded-2xl text-[color:var(--text-primary)]" />
                <div className="flex gap-2">
                  <input type="text" value={inviteForm.cidade} onChange={e => setInviteForm({...inviteForm, cidade: e.target.value})} placeholder="Cidade" className="flex-1 bg-[color:var(--bg-base)] p-4 rounded-2xl text-[color:var(--text-primary)]" />
                  <input type="text" value={inviteForm.uf} onChange={e => setInviteForm({...inviteForm, uf: e.target.value.toUpperCase().slice(0,2)})} placeholder="UF" className="w-20 bg-[color:var(--bg-base)] p-4 rounded-2xl text-[color:var(--text-primary)] text-center" />
                </div>
              </div>
              {/* Seção 4 — Foto */}
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)]">Foto <span className="text-[color:var(--text-faint)]">(Opcional)</span></p>
                <div className="flex items-center gap-3">
                  <label className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-3 bg-[color:var(--bg-base)] p-4 rounded-2xl border border-dashed border-[color:var(--border-subtle)] hover:border-[color:var(--accent-brass)] transition-colors">
                      {uploading ? <Activity className="text-teal-500 animate-spin" size={18} /> : <Upload className="text-[color:var(--text-muted)]" size={18} />}
                      <span className="text-sm text-[color:var(--text-muted)]">
                        {uploading ? 'Enviando...' : inviteForm.photo_url ? 'Trocar foto' : 'Selecionar foto'}
                      </span>
                    </div>
                    <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); }} />
                  </label>
                  {inviteForm.photo_url && (
                    <img src={inviteForm.photo_url} alt="Preview" className="w-12 h-12 rounded-xl object-cover border border-slate-600 shrink-0" />
                  )}
                </div>
                {uploadError && <p className="text-red-400 text-xs pl-1">{uploadError}</p>}
              </div>
              <button type="submit" disabled={submitting} className="w-full bg-[color:var(--accent-brass)] hover:bg-[color:var(--accent-brass-strong)] py-5 rounded-2xl font-black text-xs uppercase tracking-widest text-[color:var(--text-on-accent)] flex items-center justify-center gap-2 transition-colors">
                {submitting ? <Activity className="animate-spin"/> : <><UserPlus size={18}/> Cadastrar Cliente</>}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  if (usersSubView === 'edit' && selectedUserForEdit) {
    return (
      <div className="flex h-full flex-col bg-[color:var(--bg-elevated)]">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-5 py-5 shrink-0">
          <button
            onClick={() => { setUsersSubView('list'); setSelectedUserForEdit(null); setErrorMessage(null); }}
            className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors"
          >
            <ArrowLeft size={20}/>
          </button>
          <div className="flex items-center gap-3 min-w-0">
            {selectedUserForEdit.photo_url ? (
              <img src={selectedUserForEdit.photo_url} alt={selectedUserForEdit.fullName} className="w-9 h-9 rounded-xl object-cover border border-slate-600 shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-teal-900/40 text-teal-400 flex items-center justify-center font-black text-sm shrink-0">
                {selectedUserForEdit.fullName?.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-xl font-black text-[color:var(--text-primary)] uppercase tracking-tighter truncate">Editar Cliente</h3>
              <p className="text-[10px] text-[color:var(--text-muted)] font-mono truncate">{selectedUserForEdit.email}</p>
            </div>
          </div>
        </div>
        {/* Error */}
        {errorMessage && (
          <div className="mx-5 mt-4 bg-red-900/20 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
            <AlertTriangle size={14}/> {errorMessage}
          </div>
        )}
        {/* Scrollable form */}
        <div className="flex-1 overflow-y-auto px-5 py-5 pb-8">
          <form onSubmit={handleUpdateUser} className="space-y-3 sm:space-y-5">
            {/* Seção 1 — Identificação */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)]">Identificação</p>
              <div className="relative">
                <User className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} />
                <input required type="text" value={editForm.full_name} onChange={e => setEditForm({...editForm, full_name: e.target.value})} placeholder="Nome Completo" className="w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl text-[color:var(--text-primary)]" />
              </div>
              <div className="relative">
                <Mail className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} />
                <input type="email" value={selectedUserForEdit.email} disabled placeholder="E-mail" className="w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl text-[color:var(--text-muted)] opacity-60 cursor-not-allowed" />
              </div>
              <div className="relative">
                <Phone className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} />
                <input type="tel" value={editForm.phone_number} onChange={e => setEditForm({...editForm, phone_number: e.target.value})} placeholder="Telefone (Opcional)" className="w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl text-[color:var(--text-primary)]" />
              </div>
              <div className="relative">
                <Briefcase className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} />
                <select value={editForm.role} onChange={e => setEditForm({...editForm, role: e.target.value as UserRole})} className="w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl appearance-none text-[color:var(--text-primary)]">
                  <option value="debtor">Devedor</option>
                  <option value="investor">Investidor</option>
                </select>
              </div>
            </div>
            {/* Seção 2 — Documento */}
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)]">Documento</p>
              <div className="relative">
                <Key className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} />
                <input
                  type="text"
                  value={editForm.cpf}
                  onChange={e => {
                    const masked = maskCPF(e.target.value);
                    setEditForm({...editForm, cpf: masked});
                    setEditCpfError(null);
                  }}
                  placeholder="CPF (Opcional)"
                  className={`w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl text-[color:var(--text-primary)] ${editCpfError ? 'border border-red-500' : ''}`}
                />
              </div>
              {editCpfError && <p className="text-red-400 text-xs pl-1">{editCpfError}</p>}
            </div>
            {/* Seção 3 — Endereço */}
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)]">Endereço <span className="text-[color:var(--text-faint)]">(Opcional)</span></p>
              <div className="relative">
                <MapPin className="absolute left-4 top-4 text-[color:var(--text-muted)]" size={18} />
                <input
                  type="text"
                  value={editForm.cep}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
                    const formatted = digits.length > 5 ? `${digits.slice(0,5)}-${digits.slice(5)}` : digits;
                    setEditForm({...editForm, cep: formatted});
                    setEditCepError(null);
                    if (digits.length === 8) handleEditCepLookup(digits);
                  }}
                  placeholder="CEP"
                  className="w-full bg-[color:var(--bg-base)] p-4 pl-12 rounded-2xl text-[color:var(--text-primary)]"
                />
                {editCepLoading && <Activity className="absolute right-4 top-4 text-teal-500 animate-spin" size={18} />}
              </div>
              {editCepError && <p className="text-red-400 text-xs pl-1">{editCepError}</p>}
              <input type="text" value={editForm.logradouro} onChange={e => setEditForm({...editForm, logradouro: e.target.value})} placeholder="Logradouro" className="w-full bg-[color:var(--bg-base)] p-4 rounded-2xl text-[color:var(--text-primary)]" />
              <input type="text" value={editForm.numero} onChange={e => setEditForm({...editForm, numero: e.target.value})} placeholder="Número" className="w-full bg-[color:var(--bg-base)] p-4 rounded-2xl text-[color:var(--text-primary)]" />
              <input type="text" value={editForm.bairro} onChange={e => setEditForm({...editForm, bairro: e.target.value})} placeholder="Bairro" className="w-full bg-[color:var(--bg-base)] p-4 rounded-2xl text-[color:var(--text-primary)]" />
              <div className="flex gap-2">
                <input type="text" value={editForm.cidade} onChange={e => setEditForm({...editForm, cidade: e.target.value})} placeholder="Cidade" className="flex-1 bg-[color:var(--bg-base)] p-4 rounded-2xl text-[color:var(--text-primary)]" />
                <input type="text" value={editForm.uf} onChange={e => setEditForm({...editForm, uf: e.target.value.toUpperCase().slice(0,2)})} placeholder="UF" className="w-20 bg-[color:var(--bg-base)] p-4 rounded-2xl text-[color:var(--text-primary)] text-center" />
              </div>
            </div>
            {/* Seção 4 — Foto */}
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)]">Foto <span className="text-[color:var(--text-faint)]">(Opcional)</span></p>
              <div className="flex items-center gap-3">
                <label className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-3 bg-[color:var(--bg-base)] p-4 rounded-2xl border border-dashed border-[color:var(--border-subtle)] hover:border-[color:var(--accent-brass)] transition-colors">
                    {editUploading ? <Activity className="text-teal-500 animate-spin" size={18} /> : <Upload className="text-[color:var(--text-muted)]" size={18} />}
                    <span className="text-sm text-[color:var(--text-muted)]">
                      {editUploading ? 'Enviando...' : editForm.photo_url ? 'Trocar foto' : 'Selecionar foto'}
                    </span>
                  </div>
                  <input type="file" accept="image/*" className="hidden" disabled={editUploading} onChange={e => { const f = e.target.files?.[0]; if (f) handleEditPhotoUpload(f); }} />
                </label>
                {editForm.photo_url && (
                  <img src={editForm.photo_url} alt="Preview" className="w-12 h-12 rounded-xl object-cover border border-slate-600 shrink-0" />
                )}
              </div>
              {editUploadError && <p className="text-red-400 text-xs pl-1">{editUploadError}</p>}
            </div>
            <button type="submit" disabled={submitting || editUploading} className="w-full bg-[color:var(--accent-brass)] hover:bg-[color:var(--accent-brass-strong)] py-5 rounded-2xl font-black text-xs uppercase tracking-widest text-[color:var(--text-on-accent)] flex items-center justify-center gap-2 transition-colors">
              {submitting ? <Activity className="animate-spin"/> : <><Check size={18}/> Salvar Alterações</>}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
            <h2 className="text-2xl font-bold text-[color:var(--text-primary)] uppercase tracking-tighter">Administração de Perfis</h2>
            <p className="text-[color:var(--text-muted)] text-xs font-black uppercase tracking-widest mt-1">Colaboradores e Clientes (Modo Gestão)</p>
        </div>
        <div className="flex items-center gap-3 w-full lg:w-auto">
            <div className="relative flex-1 sm:flex-none sm:w-64">
                <Search className="absolute left-3 top-2.5 text-[color:var(--text-muted)]" size={18} />
                <input type="text" placeholder="Buscar e-mail ou nome..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl pl-10 pr-4 py-2 text-[color:var(--text-primary)] outline-none focus:ring-2 focus:ring-teal-500 transition-all font-medium" />
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <button onClick={fetchUsersAndInvites} aria-label="Atualizar lista de usuários" className="p-2.5 min-h-[44px] min-w-[44px] bg-[color:var(--bg-elevated)] hover:bg-[color:var(--bg-soft)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] rounded-2xl border border-[color:var(--border-subtle)] transition-colors flex items-center justify-center" title="Atualizar Lista">
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
                <button onClick={() => setUsersSubView('invite')} className="bg-[color:var(--accent-brass)] hover:bg-[color:var(--accent-brass-strong)] text-[color:var(--text-on-accent)] px-5 py-2.5 min-h-[44px] rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg font-bold text-sm whitespace-nowrap">
                    <UserPlus size={18} /> <span className="hidden sm:inline">Cadastrar Cliente</span><span className="sm:hidden">Novo</span>
                </button>
            </div>
        </div>
      </div>

      {errorMessage && usersSubView === 'list' && (
          <div className="space-y-3 animate-shake"><div className="bg-red-900/20 border border-red-900/50 p-4 rounded-2xl flex items-center gap-3 text-red-400 text-xs font-bold"><AlertTriangle size={18} className="shrink-0" /><span>{errorMessage}</span></div></div>
      )}

      <div className="flex gap-2 border-b border-[color:var(--border-subtle)] pb-px overflow-x-auto scrollbar-hide">
        <button onClick={() => setActiveTab('all')} className={`px-4 py-3 text-xs font-black uppercase transition-colors border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'all' ? 'text-teal-400 border-teal-400' : 'text-[color:var(--text-muted)] border-transparent hover:text-[color:var(--text-secondary)]'}`}><Users size={16}/> Base Geral ({counts.all})</button>
        <button onClick={() => setActiveTab('pending')} className={`px-4 py-3 text-xs font-black uppercase transition-colors border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'pending' ? 'text-amber-400 border-amber-400' : 'text-[color:var(--text-muted)] border-transparent hover:text-[color:var(--text-secondary)]'}`}><Hourglass size={16}/> Pendentes ({counts.pending})</button>
        <button onClick={() => setActiveTab('investor')} className={`px-4 py-3 text-xs font-black uppercase transition-colors border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'investor' ? 'text-teal-400 border-teal-400' : 'text-[color:var(--text-muted)] border-transparent hover:text-[color:var(--text-secondary)]'}`}><DollarSign size={16}/> Investidores ({counts.investor})</button>
        <button onClick={() => setActiveTab('debtor')} className={`px-4 py-3 text-xs font-black uppercase transition-colors border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'debtor' ? 'text-teal-400 border-teal-400' : 'text-[color:var(--text-muted)] border-transparent hover:text-[color:var(--text-secondary)]'}`}><CreditCard size={16}/> Devedores ({counts.debtor})</button>
      </div>

       {loading && displayUsers.length === 0 ? (
        <div className="flex justify-center p-20 text-teal-500"><Activity className="animate-spin" /></div>
      ) : filteredUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileSearch size={40} className="text-[color:var(--text-faint)] mb-4" />
          <p className="text-[color:var(--text-secondary)] font-bold text-sm uppercase tracking-widest">Nenhum usuário encontrado</p>
          {searchTerm && <p className="text-[color:var(--text-faint)] text-xs mt-2">Tente outro termo de busca</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredUsers.map(user => {
                const isOwner = currentTenant?.owner_email && user.email?.toLowerCase() === currentTenant.owner_email.toLowerCase();
                const isAdmin = user.role === 'admin';
                const isPending = user.status === 'PENDENTE';

                const cardStyles = isPending
                    ? 'border-amber-500/30 shadow-amber-900/10 bg-[color:var(--bg-elevated)]'
                    : isOwner ? 'border-purple-500/50 shadow-purple-900/20' : isAdmin ? 'border-[color:var(--border-subtle)] shadow-slate-900/10' : 'border-[color:var(--border-subtle)] hover:border-teal-900';

                return (
                    <div key={user.id} className={`bg-[color:var(--bg-elevated)] border rounded-[2rem] p-6 shadow-lg transition-all flex flex-col justify-between relative group/card ${cardStyles}`}>
                        {isPending && user.inviteId && (
                            <button onClick={() => handleDeleteInvite(user.inviteId!)} aria-label={`Cancelar convite de ${user.fullName}`} className="absolute top-4 right-4 text-[color:var(--text-muted)] hover:text-red-400 transition-colors p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center bg-[color:var(--bg-base)]/50 rounded-xl z-10 border border-[color:var(--border-subtle)]"><Trash2 size={16} /></button>
                        )}
                        {!isPending && (
                            <button data-testid="edit-user-btn" onClick={() => {
                              setSelectedUserForEdit(user);
                              setEditForm({
                                full_name: user.fullName,
                                role: user.role,
                                cpf: maskCPF(user.cpf || ''),
                                phone_number: user.phone_number || '',
                                cep: user.cep ? (user.cep.length === 8 ? `${user.cep.slice(0,5)}-${user.cep.slice(5)}` : user.cep) : '',
                                logradouro: user.logradouro || '',
                                numero: user.numero || '',
                                bairro: user.bairro || '',
                                cidade: user.cidade || '',
                                uf: user.uf || '',
                                photo_url: user.photo_url || '',
                              });
                              setEditCepError(null);
                              setEditCpfError(null);
                              setEditUploadError(null);
                              setErrorMessage(null);
                              setUsersSubView('edit');
                            }} aria-label={`Editar ${user.fullName}`} className="absolute top-4 right-4 text-[color:var(--text-muted)] hover:text-teal-400 transition-colors p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center bg-[color:var(--bg-base)]/50 rounded-xl z-10 border border-[color:var(--border-subtle)]"><Pencil size={16} /></button>
                        )}

                        <div>
                            <div className="flex items-center gap-4 mb-4">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg overflow-hidden ${
                                    isPending ? 'bg-amber-900/40 text-amber-400 border border-amber-500/30' :
                                    isOwner ? 'bg-purple-900/40 text-purple-400 border border-purple-500/30' :
                                    isAdmin ? 'bg-indigo-900/40 text-indigo-400' :
                                    user.role === 'investor' ? 'bg-teal-900/40 text-teal-400' : 'bg-red-900/40 text-red-400'
                                }`}>
                                    {!isPending && user.photo_url ? (
                                        <img src={user.photo_url} alt={user.fullName} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                    ) : isPending ? <Hourglass size={20}/> : isOwner ? <Crown size={22}/> : isAdmin ? <Shield size={20}/> : user.fullName?.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0 pr-8">
                                    <h3 className="text-[color:var(--text-primary)] font-bold truncate text-base">{user.fullName}</h3>
                                    <p className="text-[color:var(--text-muted)] text-[10px] truncate font-mono">{user.email}</p>
                                    <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                                        isPending ? 'bg-amber-900/30 text-amber-400 border border-amber-500/20' :
                                        isOwner ? 'bg-purple-900/30 text-purple-400 border border-purple-500/20' :
                                        isAdmin ? 'bg-indigo-900/30 text-indigo-400' :
                                        user.role === 'investor' ? 'bg-teal-900/30 text-teal-400' : 'bg-red-900/30 text-red-400'
                                    }`}>
                                        {isPending ? 'Pendente' : user.role === 'investor' ? 'Investidor' : 'Pagador'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                            {isPending ? (
                                <button onClick={() => handleSendLink(user.inviteCode!)} className="flex items-center justify-center gap-2 bg-[color:var(--bg-base)] hover:bg-amber-900/30 border border-[color:var(--border-subtle)] hover:border-amber-700 text-amber-400 hover:text-amber-300 text-[10px] font-black uppercase py-3 rounded-xl transition-colors tracking-widest">
                                    {copiedInviteCode === user.inviteCode ? <Check size={14} /> : <Send size={14} />}
                                    {copiedInviteCode === user.inviteCode ? 'Copiado!' : 'Enviar Link'}
                                </button>
                            ) : (
                                <button onClick={() => onViewDashboard(user.id)} className="flex items-center justify-center gap-2 bg-[color:var(--bg-base)] hover:bg-[color:var(--bg-soft)] text-[color:var(--text-primary)] border border-[color:var(--border-subtle)] text-[10px] font-black uppercase py-3 rounded-xl transition-colors tracking-widest">
                                    <FileSearch size={14} /> Ver Perfil
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
      )}


    </div>
  );
};

export default AdminUsers;
