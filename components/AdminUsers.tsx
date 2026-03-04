
import React, { useEffect, useState } from 'react';
import { getSupabase, logError, parseSupabaseError } from '../services/supabase';
import { Profile, UserRole, Tenant, Invite } from '../types';
import { User, PlusCircle, Search, X, DollarSign, Activity, Users, CreditCard, Pencil, AlertTriangle, FileSearch, RefreshCw, Crown, Shield, Clipboard, Check, Key, Mail, Phone, Briefcase, Send, Trash2, Hourglass } from 'lucide-react';

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
};

interface AdminUsersProps {
  onViewDashboard: (userId: string) => void;
}

const AdminUsers: React.FC<AdminUsersProps> = ({ onViewDashboard }) => {
  const [displayUsers, setDisplayUsers] = useState<DisplayUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'investor' | 'debtor' | 'pending'>('all');
  
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
  
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<DisplayUser | null>(null);

  const [inviteForm, setInviteForm] = useState({ 
    full_name: '', email: '', phone_number: '', role: 'debtor' as UserRole
  });
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedInviteCode, setCopiedInviteCode] = useState<string | null>(null);

  const [editForm, setEditForm] = useState({ full_name: '', role: 'investor' as UserRole, cpf: '' });
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
            .eq('id', authUser?.id)
            .single();

        if (profError) throw profError;
        setCurrentTenant(adminProfile.tenants as any);
        const tenantId = adminProfile.tenant_id;

        // Fetch in parallel
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
            cpf: p.cpf || undefined
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
            cpf: undefined
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
  
  const handleGenerateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    try {
        const supabase = getSupabase();
        if (!supabase) throw new Error("Supabase não inicializado.");
        const { data, error } = await supabase.rpc('generate_invite_code', {
            p_full_name: inviteForm.full_name,
            p_email: inviteForm.email,
            p_phone_number: inviteForm.phone_number,
            p_role: inviteForm.role
        });
        if (error) throw error;
        setGeneratedCode(data);
    } catch(err: any) {
        logError("GenerateInvite", err);
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
          fetchUsersAndInvites(); // Refresh list
      }
  };
  
  const resetInviteModal = () => {
    setInviteForm({ full_name: '', email: '', phone_number: '', role: 'debtor' });
    setGeneratedCode(null);
    setErrorMessage(null);
    setSubmitting(false);
    fetchUsersAndInvites(); // Refresh list after closing
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedInviteCode(code);
    setTimeout(() => setCopiedInviteCode(null), 2000);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForEdit) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
        const supabase = getSupabase();
        const cleanCpf = (editForm.cpf || '').replace(/\D/g, '');
        const updates = { 
            full_name: editForm.full_name, 
            role: editForm.role,
            cpf: cleanCpf || null,
            updated_at: new Date().toISOString()
        };
        const { error } = await supabase.from('profiles').update(updates).eq('id', selectedUserForEdit.id);
        if (error) throw error;
        fetchUsersAndInvites();
        setIsEditModalOpen(false);
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
            <h2 className="text-2xl font-bold text-white uppercase tracking-tighter">Administração de Perfis</h2>
            <p className="text-slate-500 text-xs font-black uppercase tracking-widest mt-1">Colaboradores e Clientes (Modo Gestão)</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto">
            <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 text-slate-500" size={18} />
                <input type="text" placeholder="Buscar e-mail ou nome..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-2xl pl-10 pr-4 py-2 text-white outline-none focus:ring-2 focus:ring-teal-500 transition-all font-medium" />
            </div>
            <button onClick={fetchUsersAndInvites} className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-2xl border border-slate-700 transition-colors" title="Atualizar Lista">
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => setIsInviteModalOpen(true)} className="w-full sm:w-auto bg-teal-600 hover:bg-teal-500 text-white px-6 py-2.5 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-teal-900/20 font-bold text-sm">
                <PlusCircle size={18} /> Gerar Convite
            </button>
        </div>
      </div>

      {errorMessage && !isInviteModalOpen && (
          <div className="space-y-3 animate-shake"><div className="bg-red-900/20 border border-red-900/50 p-4 rounded-2xl flex items-center gap-3 text-red-400 text-xs font-bold"><AlertTriangle size={18} className="shrink-0" /><span>{errorMessage}</span></div></div>
      )}

      <div className="flex gap-2 border-b border-slate-800 pb-px overflow-x-auto scrollbar-hide">
        <button onClick={() => setActiveTab('all')} className={`px-4 py-3 text-xs font-black uppercase transition-colors border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'all' ? 'text-teal-400 border-teal-400' : 'text-slate-500 border-transparent hover:text-slate-300'}`}><Users size={16}/> Base Geral ({counts.all})</button>
        <button onClick={() => setActiveTab('pending')} className={`px-4 py-3 text-xs font-black uppercase transition-colors border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'pending' ? 'text-amber-400 border-amber-400' : 'text-slate-500 border-transparent hover:text-slate-300'}`}><Hourglass size={16}/> Pendentes ({counts.pending})</button>
        <button onClick={() => setActiveTab('investor')} className={`px-4 py-3 text-xs font-black uppercase transition-colors border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'investor' ? 'text-teal-400 border-teal-400' : 'text-slate-500 border-transparent hover:text-slate-300'}`}><DollarSign size={16}/> Investidores ({counts.investor})</button>
        <button onClick={() => setActiveTab('debtor')} className={`px-4 py-3 text-xs font-black uppercase transition-colors border-b-2 flex items-center gap-2 whitespace-nowrap ${activeTab === 'debtor' ? 'text-teal-400 border-teal-400' : 'text-slate-500 border-transparent hover:text-slate-300'}`}><CreditCard size={16}/> Devedores ({counts.debtor})</button>
      </div>

       {loading && displayUsers.length === 0 ? (
        <div className="flex justify-center p-20 text-teal-500"><Activity className="animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredUsers.map(user => {
                const isOwner = currentTenant?.owner_email && user.email?.toLowerCase() === currentTenant.owner_email.toLowerCase();
                const isAdmin = user.role === 'admin';
                const isPending = user.status === 'PENDENTE';

                const cardStyles = isPending 
                    ? 'border-amber-500/30 shadow-amber-900/10 bg-slate-800/80' 
                    : isOwner ? 'border-purple-500/50 shadow-purple-900/20' : isAdmin ? 'border-slate-600 shadow-slate-900/10' : 'border-slate-700 hover:border-teal-900';
                
                return (
                    <div key={user.id} className={`bg-slate-800 border rounded-[2rem] p-6 shadow-lg transition-all flex flex-col justify-between relative group/card ${cardStyles}`}>
                        {isPending && user.inviteId && (
                            <button onClick={() => handleDeleteInvite(user.inviteId!)} className="absolute top-6 right-6 text-slate-500 hover:text-red-400 transition-colors p-2 bg-slate-900/50 rounded-xl opacity-0 group-hover/card:opacity-100 z-10 border border-slate-700"><Trash2 size={16} /></button>
                        )}
                        {!isPending && (
                            <button data-testid="edit-user-btn" onClick={() => { setSelectedUserForEdit(user); setEditForm({ full_name: user.fullName, role: user.role, cpf: user.cpf || '' }); setIsEditModalOpen(true); }} className="absolute top-6 right-6 text-slate-500 hover:text-teal-400 transition-colors p-2 bg-slate-900/50 rounded-xl opacity-0 group-hover/card:opacity-100 z-10 border border-slate-700"><Pencil size={16} /></button>
                        )}
                        
                        <div>
                            <div className="flex items-center gap-4 mb-4">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg ${
                                    isPending ? 'bg-amber-900/40 text-amber-400 border border-amber-500/30' :
                                    isOwner ? 'bg-purple-900/40 text-purple-400 border border-purple-500/30' :
                                    isAdmin ? 'bg-indigo-900/40 text-indigo-400' : 
                                    user.role === 'investor' ? 'bg-teal-900/40 text-teal-400' : 'bg-red-900/40 text-red-400'
                                }`}>
                                    {isPending ? <Hourglass size={20}/> : isOwner ? <Crown size={22}/> : isAdmin ? <Shield size={20}/> : user.fullName?.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0 pr-8">
                                    <h3 className="text-white font-bold truncate text-base">{user.fullName}</h3>
                                    <p className="text-slate-500 text-[10px] truncate font-mono">{user.email}</p>
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
                                <button onClick={() => handleCopyCode(user.inviteCode!)} className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-amber-900/30 border border-slate-700 hover:border-amber-700 text-amber-400 hover:text-amber-300 text-[10px] font-black uppercase py-3 rounded-xl transition-colors tracking-widest">
                                    {copiedInviteCode === user.inviteCode ? <Check size={14} /> : <Clipboard size={14} />}
                                    {copiedInviteCode === user.inviteCode ? 'Copiado!' : 'Copiar Convite'}
                                </button>
                            ) : (
                                <button onClick={() => onViewDashboard(user.id)} className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-700 text-white border border-slate-700 text-[10px] font-black uppercase py-3 rounded-xl transition-colors tracking-widest">
                                    <FileSearch size={14} /> Auditoria Financeira
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
      )}

      {isEditModalOpen && selectedUserForEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] w-full max-w-md shadow-2xl p-8 animate-fade-in-up">
                <form onSubmit={handleUpdateUser} className="space-y-4">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-black text-white uppercase tracking-tighter">Editar Perfil</h3>
                        <button type="button" onClick={() => setIsEditModalOpen(false)} className="text-slate-500 hover:text-white"><X/></button>
                    </div>
                    <input required value={editForm.full_name} onChange={e => setEditForm({...editForm, full_name: e.target.value})} className="w-full bg-slate-900 p-3 rounded" placeholder="Nome Completo"/>
                    <input value={editForm.cpf} onChange={e => setEditForm({...editForm, cpf: e.target.value})} className="w-full bg-slate-900 p-3 rounded" placeholder="CPF (opcional)"/>
                    <select value={editForm.role} onChange={e => setEditForm({...editForm, role: e.target.value as UserRole})} className="w-full bg-slate-900 p-3 rounded">
                        <option value="investor">Investidor</option>
                        <option value="debtor">Devedor</option>
                    </select>
                    <button type="submit" disabled={submitting} className="w-full bg-teal-600 hover:bg-teal-500 py-3 rounded text-white font-bold">
                        {submitting ? <Activity className="animate-spin mx-auto"/> : 'Salvar'}
                    </button>
                </form>
            </div>
        </div>
      )}

      {isInviteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
             <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] w-full max-w-md shadow-2xl p-8 animate-fade-in-up">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-black text-white uppercase tracking-tighter">Gerar Convite de Acesso</h3>
                    <button onClick={() => { setIsInviteModalOpen(false); resetInviteModal(); }} className="text-slate-500 hover:text-white transition-colors"><X size={24} /></button>
                </div>
                {errorMessage && (<div className="mb-4 bg-red-900/20 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2"><AlertTriangle size={14}/> {errorMessage}</div>)}
                {generatedCode ? (
                    <div className="text-center space-y-6">
                        <div className="bg-teal-900/20 border border-teal-900/50 p-6 rounded-3xl">
                            <p className="text-sm text-teal-400 font-bold uppercase tracking-widest mb-2">Código Gerado!</p>
                            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-700 flex items-center justify-center gap-4"><Key size={24} className="text-teal-500"/><p data-testid="invite-code" className="text-4xl font-black text-white tracking-[0.2em] font-mono">{generatedCode}</p></div>
                            <p className="text-xs text-slate-500 mt-4">Envie para o usuário realizar o cadastro.</p>
                        </div>
                        <button onClick={() => handleCopyCode(generatedCode)} className={`w-full py-4 rounded-xl text-xs font-black uppercase flex items-center justify-center gap-2 transition-all ${copiedInviteCode === generatedCode ? 'bg-green-600' : 'bg-teal-600 hover:bg-teal-500 text-white'}`}>{copiedInviteCode === generatedCode ? <Check/> : <Clipboard/>} {copiedInviteCode === generatedCode ? 'Copiado!' : 'Copiar'}</button>
                    </div>
                ) : (
                    <form onSubmit={handleGenerateInvite} className="space-y-4">
                        {/* FORM FIELDS REMAIN THE SAME */}
                        <div className="relative group"><User className="absolute left-4 top-4 text-slate-500" size={18} /><input required type="text" value={inviteForm.full_name} onChange={e => setInviteForm({...inviteForm, full_name: e.target.value})} placeholder="Nome Completo" className="w-full bg-slate-900 p-4 pl-12 rounded-2xl" /></div>
                        <div className="relative group"><Mail className="absolute left-4 top-4 text-slate-500" size={18} /><input required type="email" value={inviteForm.email} onChange={e => setInviteForm({...inviteForm, email: e.target.value})} placeholder="E-mail" className="w-full bg-slate-900 p-4 pl-12 rounded-2xl" /></div>
                        <div className="relative group"><Phone className="absolute left-4 top-4 text-slate-500" size={18} /><input type="tel" value={inviteForm.phone_number} onChange={e => setInviteForm({...inviteForm, phone_number: e.target.value})} placeholder="Telefone (Opcional)" className="w-full bg-slate-900 p-4 pl-12 rounded-2xl" /></div>
                        <div className="relative group"><Briefcase className="absolute left-4 top-4 text-slate-500" size={18} /><select required value={inviteForm.role} onChange={e => setInviteForm({...inviteForm, role: e.target.value as UserRole})} className="w-full bg-slate-900 p-4 pl-12 rounded-2xl appearance-none"><option value="debtor">Devedor</option><option value="investor">Investidor</option></select></div>
                        <button type="submit" disabled={submitting} className="w-full bg-teal-600 py-5 rounded-2xl font-black text-xs uppercase tracking-widest">{submitting ? <Activity className="animate-spin mx-auto"/> : 'Gerar'}</button>
                    </form>
                )}
             </div>
          </div>
      )}
    </div>
  );
};

export default AdminUsers;
