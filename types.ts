

export type UserRole = 'admin' | 'investor' | 'debtor';

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

  // Subscription (Stripe)
  plan?: 'free' | 'pro' | 'pro_max';
  plan_status?: 'active' | 'inactive' | 'past_due' | 'canceled';
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  plan_updated_at?: string;
  trial_ends_at?: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  tenant_id: string;
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
}

// Interface para a View SQL view_investor_balances
export interface InvestorBalanceView {
  profile_id: string;
  tenant_id: string;
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
  interest_payments_total?: number;
  contract_name?: string; // Virtual for UI
  investment?: Investment; // Join
}

export interface Investment {
  id: number;
  user_id: string;      
  payer_id?: string;    
  tenant_id: string;    
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
  calculation_mode?: 'auto' | 'manual';

  // Rastreamento de Origem de Capital (Wealth Management)
  source_capital?: number; // Aporte do Bolso
  source_profit?: number;  // Lucro Reinvestido

  // Ciclo de vida e renovação (V18)
  parent_investment_id?: number | null;
  status?: 'active' | 'completed' | 'defaulted' | 'renewed';
  notes?: string | null;

  // Campos virtuais (Joins)
  investor?: { full_name: string; cpf?: string; email?: string; role?: UserRole };
  payer?: { full_name: string; cpf?: string; email?: string };
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
  RESET_PASSWORD = 'RESET_PASSWORD'
}
