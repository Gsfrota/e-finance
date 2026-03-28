

export type UserRole = 'admin' | 'investor' | 'debtor';
export type CompanyScope = 'all' | string | null;
export type CompanyAccessMode = 'enabled' | 'upsell_locked';

export interface Tenant {
  id: string;
  name: string;
  logo_url?: string;
  slug: string;
  created_at: string;

  // Owner Info (Explicit)
  owner_name?: string;
  owner_email?: string;

  // Pix Configuration
  pix_key?: string;
  pix_key_type?: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
  pix_name?: string;
  pix_city?: string;
  // Support
  support_whatsapp?: string;
  timezone?: string;  // IANA timezone (ex: 'America/Sao_Paulo')

  // Subscription (Stripe)
  plan?: 'free' | 'caderneta' | 'empresarial';
  plan_status?: 'active' | 'inactive' | 'past_due' | 'canceled';
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  plan_updated_at?: string;
  trial_ends_at?: string;
}

export interface Company {
  id: string;
  tenant_id: string;
  name: string;
  logo_url?: string | null;
  pix_key?: string | null;
  pix_key_type?: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP' | null;
  pix_name?: string | null;
  pix_city?: string | null;
  support_whatsapp?: string | null;
  timezone?: string | null;
  is_primary?: boolean;
  created_at?: string;
  updated_at?: string;
  is_fallback?: boolean;
}

export interface Profile {
  id: string;
  auth_user_id?: string;
  email: string;
  full_name: string;
  role: UserRole;
  tenant_id: string;
  company_id?: string | null;
  phone_number?: string;
  cpf?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  photo_url?: string;
  updated_at: string;
  tenants?: Tenant;
  company?: Company | null;
}

// Interface para a View SQL view_investor_balances
export interface InvestorBalanceView {
  profile_id: string;
  tenant_id: string;
  company_id?: string | null;
  full_name: string;
  total_own_capital: number;       // Dinheiro do Bolso
  total_profit_reinvested: number; // Lucro que virou Principal
  total_profit_received: number;   // Lucro Total (Pago)
  available_profit_balance: number;// Saldo Livre para Reinvestir
}

export interface LoanInstallment {
  id: string;
  investment_id: number;
  tenant_id: string;
  company_id?: string | null;
  number: number;
  due_date: string;
  amount_principal: number;
  amount_interest: number;
  amount_total: number;
  amount_paid: number;
  // Penalty Fields
  fine_amount: number;
  interest_delay_amount: number;
  
  status: 'pending' | 'paid' | 'late' | 'partial';
  paid_at?: string;
  payment_method?: string;
  interest_payments_total?: number;
  missed_at?: string;          // Timestamp da falta registrada
  deferred_from_id?: string;   // ID da parcela de origem (quando postergada)
  notes?: string;
  contract_name?: string; // Virtual for UI
  investment?: Investment; // Join
}

export interface PaymentTransaction {
  id: string;
  tenant_id: string;
  investment_id: number;
  installment_id: string;
  transaction_type: 'payment' | 'surplus_applied' | 'surplus_received' | 'deferred' | 'missed' | 'reversal';
  amount: number;
  principal_portion: number;
  interest_portion: number;
  extras_portion: number;
  related_installment_id?: string;
  related_installment_number?: number;
  payment_method?: string;
  notes?: string;
  receipt_id?: string;
  created_at: string;
}

export interface Investment {
  id: number;
  user_id: string;      
  payer_id?: string;    
  tenant_id: string;    
  company_id?: string | null;
  asset_name: string;   
  amount_invested: number;
  current_value: number; // Montante Total do Contrato (Principal + Juros)
  type: 'Stock' | 'Crypto' | 'Real Estate' | 'Bond' | 'ETF' | 'Financing';
  frequency?: 'monthly' | 'weekly' | 'daily' | 'freelancer';
  created_at: string;
  
  // Campos Financeiros (Mesa de Crédito)
  interest_rate: number;
  installment_value: number;
  total_installments: number;
  current_installment: number;
  
  // Configuração de Datas (Novos campos nullable)
  due_day?: number | null; // Null se for semanal/diário
  weekday?: number | null; // 0=Dom, 1=Seg... Null se for mensal
  start_date?: string | null; // Null se for mensal/semanal (dependendo da lógica)
  calculation_mode?: 'auto' | 'manual' | 'interest_only';
  bullet_principal_mode?: 'together' | 'separate' | null;
  remaining_balance?: number | null;   // Saldo devedor atual (bullet rotativo)
  capitalize_interest?: boolean;       // TRUE = juros não pago capitaliza no saldo

  // Rastreamento de Origem de Capital (Wealth Management)
  source_capital?: number; // Aporte do Bolso
  source_profit?: number;  // Lucro Reinvestido

  // Ciclo de vida e renovação (V18)
  parent_investment_id?: number | null;
  status?: 'active' | 'completed' | 'defaulted' | 'renewed';
  notes?: string | null;

  // Campos expandidos de contratos (V23)
  original_contract_code?: string | null; // Código original de sistemas legados (ex: "CT14383727")
  end_date?: string | null;               // Data de término do contrato (YYYY-MM-DD)
  include_saturday?: boolean;             // Inclui sábado no agendamento (padrão: true)
  include_sunday?: boolean;               // Inclui domingo no agendamento (padrão: true)
  daily_interest_rate?: number | null;    // Taxa de juros diária (% ao dia)
  discount?: number;                      // Desconto aplicado ao principal
  surcharge?: number;                     // Acréscimo aplicado ao principal

  // Campos virtuais (Joins)
  investor?: { full_name: string; cpf?: string; email?: string; role?: UserRole };
  payer?: { full_name: string; cpf?: string; email?: string; photo_url?: string };
  investor_name?: string;
  payer_name?: string;
  loan_installments?: LoanInstallment[];
  renewals?: Investment[];
}

// Histórico de renegociação (V18)
export interface ContractRenegotiation {
  id: number;
  investment_id: number;
  tenant_id: string;
  company_id?: string | null;
  renegotiated_at: string;
  old_installment_value?: number | null;
  new_installment_value?: number | null;
  old_total_installments?: number | null;
  new_total_installments?: number | null;
  old_due_date?: string | null;
  new_due_date?: string | null;
  reason?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface AvulsoPayment {
  id: string;
  investment_id: number;
  tenant_id: string;
  company_id?: string | null;
  amount: number;
  notes: string | null;
  paid_at: string;
  created_at: string;
}

// Métricas calculadas para o detalhe de um contrato
export interface ContractMetrics {
  jurosPagos: number;
  principalRecuperado: number;
  totalRecebido: number;
  jurosAReceber: number;
  principalAReceber: number;
  fineAcumulada: number;
  rentabilidadeReal: number;
  parcelasPagas: number;
  parcelasPartiais: number;
  parcelasPendentes: number;
  parcelasAtrasadas: number;
  parcelasTotal: number;
  saudeContrato: number;
}

export interface AdminDashboardStats {
  active_portfolio: number;
  expected_month: number;
  received_month: number;
  total_overdue: number;
  active_contracts: number;
}

export interface DashboardKPIs {
  // Mês Atual
  receivedMonth: number;
  receivedByPaymentMonth: number;
  receivedByDueMonth: number;
  expectedMonth: number;
  
  // Acumulado (All Time)
  totalInvestedHistorical: number;
  totalPrincipalRepaid: number;
  totalProfitReceived: number;      // LUCRO DE CAIXA (Juros/Multas pagos) - Renomeado de totalProfitRealized
  
  // Potencial e A Receber
  totalProfitPotential: number;     // LUCRO DE COMPETÊNCIA (Potencial total de todos os contratos)
  totalProfitReceivable: number;    // LUCRO A RECEBER (Potencial - Recebido)
  
  // Situação Atual
  activeStreetMoney: number;        // Total na rua (Principal)
  activeOwnCapital: number;         // Parte do dinheiro na rua que é Capital Próprio
  activeReinvestedCapital: number;  // Parte do dinheiro na rua que é Lucro Reinvestido
  
  totalOverdue: number;
  totalReceivable: number;
  activeContractsCount?: number;
  overdueContractsCount?: number;

  // Recebidos Hoje
  receivedToday: number;
  receivedTodayCount: number;

  // New Wealth Metrics (Optional for compatibility)
  totalReinvestedCapital?: number;
  totalOwnCapital?: number;
}

export interface DashboardMetrics {
  totalInvested: number;
  currentTotal: number;
  totalProfit: number;
  overallRoi: number;
  assetCount: number;
}

export interface Invite {
  id: string;
  tenant_id: string;
  company_id?: string | null;
  code: string;
  role: UserRole;
  full_name?: string;
  email?: string;
  phone_number?: string;
  cpf?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  photo_url?: string;
  status: 'pending' | 'accepted';
  expires_at: string;
  created_by: string;
}

// BR-REL-007: Visão Mensal do Investidor
export interface MonthlyDebtorSummary {
  debtorName: string;
  totalDue: number;
  totalPaid: number;
  installmentCount: number;
  overdueCount: number;
  overdueAmount: number;
}

export interface MonthlyOverdueEntry {
  debtorName: string;
  amount: number;
  daysLate: number;
}

export interface MonthlyViewData {
  month: Date;
  monthLabel: string;
  totalExpected: number;
  totalPaid: number;
  paymentPercent: number;
  interestReceived: number;
  interestExpected: number;
  capitalAllocated: number;
  overdueCount: number;
  overdueAmount: number;
  overdueByDebtor: MonthlyOverdueEntry[];
  debtors: MonthlyDebtorSummary[];
}

export enum AppView {
  LOGIN = 'LOGIN',
  HOME = 'HOME',
  DASHBOARD = 'DASHBOARD',
  USERS = 'USERS',
  USER_DETAILS = 'USER_DETAILS',
  CONTRACTS = 'CONTRACTS',
  SETTINGS = 'SETTINGS',
  ASSISTANT = 'ASSISTANT',
  COLLECTION = 'COLLECTION',
  RESET_PASSWORD = 'RESET_PASSWORD',
  LEGACY_CONTRACT = 'LEGACY_CONTRACT',
  TOP_CLIENTES = 'TOP_CLIENTES'
}
