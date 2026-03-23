
import { useState, useEffect, useMemo } from 'react';
import { getSupabase } from '../services/supabase';
import { Investment, LoanInstallment } from '../types';

export interface ClienteScore {
  profileId: string;
  fullName: string;
  cpf?: string;
  totalPrincipal: number;
  totalContracts: number;
  totalInstallments: number;
  paidOnTime: number;
  paidLate: number;
  overdue: number;
  punctualityRate: number;
  completionRate: number;
  score: number;
  hasResolved: boolean;
}

export interface TopClientesKPIs {
  totalClientes: number;
  mediaScore: number;
  clientesPontuais: number;
  clientesRisco: number;
}

export interface TopClientesState {
  clientes: ClienteScore[];
  loading: boolean;
  error: string | null;
  kpis: TopClientesKPIs;
}

export function useTopClientes(tenantId: string | undefined, companyId?: string | null): TopClientesState {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [installments, setInstallments] = useState<LoanInstallment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;

    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabase();

        let invQuery = supabase
            .from('investments')
            .select('id, payer_id, amount_invested, tenant_id, payer:profiles!investments_payer_id_fkey(id, full_name, cpf)')
            .eq('tenant_id', tenantId);
        if (companyId) invQuery = invQuery.eq('company_id', companyId);

        let instQuery = supabase
            .from('loan_installments')
            .select('id, investment_id, due_date, status, paid_at, tenant_id')
            .eq('tenant_id', tenantId);
        if (companyId) instQuery = instQuery.eq('company_id', companyId);

        const [invRes, instRes] = await Promise.all([invQuery, instQuery]);

        if (invRes.error) throw invRes.error;
        if (instRes.error) throw instRes.error;

        if (!cancelled) {
          setInvestments(invRes.data as any[]);
          setInstallments(instRes.data as any[]);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Erro ao carregar dados');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [tenantId, companyId]);

  const clientes = useMemo(() => {
    if (!investments.length) return [];

    // Group investments by payer
    const payerMap = new Map<string, {
      fullName: string;
      cpf?: string;
      investmentIds: number[];
      totalPrincipal: number;
    }>();

    for (const inv of investments) {
      const payerId = inv.payer_id;
      if (!payerId) continue;

      const payer = inv.payer as any;
      const existing = payerMap.get(payerId);
      if (existing) {
        existing.investmentIds.push(inv.id);
        existing.totalPrincipal += Number(inv.amount_invested) || 0;
      } else {
        payerMap.set(payerId, {
          fullName: payer?.full_name || 'Sem nome',
          cpf: payer?.cpf,
          investmentIds: [inv.id],
          totalPrincipal: Number(inv.amount_invested) || 0,
        });
      }
    }

    // Index installments by investment_id
    const instByInv = new Map<number, typeof installments>();
    for (const inst of installments) {
      const list = instByInv.get(inst.investment_id) || [];
      list.push(inst);
      instByInv.set(inst.investment_id, list);
    }

    // Find max principal for normalization
    let maxPrincipal = 0;
    for (const p of payerMap.values()) {
      if (p.totalPrincipal > maxPrincipal) maxPrincipal = p.totalPrincipal;
    }

    const results: ClienteScore[] = [];

    for (const [profileId, data] of payerMap) {
      // Collect all installments for this payer
      const allInst: typeof installments = [];
      for (const invId of data.investmentIds) {
        const list = instByInv.get(invId);
        if (list) allInst.push(...list);
      }

      const totalInstallments = allInst.length;

      // Resolved = paid or partial (has a final status)
      const resolved = allInst.filter(i => i.status === 'paid' || i.status === 'partial');
      const overdue = allInst.filter(i => i.status === 'late' || i.status === 'pending').filter(i => {
        const today = new Date().toISOString().split('T')[0];
        return i.due_date < today;
      });

      // Paid on time: paid_at <= due_date (or same day)
      const paidOnTime = resolved.filter(i => {
        if (!i.paid_at) return false;
        const paidDate = i.paid_at.split('T')[0];
        return paidDate <= i.due_date;
      }).length;

      const paidLate = resolved.length - paidOnTime;

      // Punctuality: paid on time / all due (resolved + overdue)
      const allDue = resolved.length + overdue.length;
      const punctualityRate = allDue > 0 ? paidOnTime / allDue : 0;

      // Completion: total paid / (total due = resolved + overdue)
      const totalDue = resolved.length + overdue.length;
      const completionRate = totalDue > 0 ? resolved.length / totalDue : 0;

      // Normalized value
      const valorNorm = maxPrincipal > 0 ? data.totalPrincipal / maxPrincipal : 0;

      // Score
      const score = resolved.length > 0
        ? (punctualityRate * 0.5 + completionRate * 0.3 + valorNorm * 0.2) * 100
        : 0;

      results.push({
        profileId,
        fullName: data.fullName,
        cpf: data.cpf,
        totalPrincipal: data.totalPrincipal,
        totalContracts: data.investmentIds.length,
        totalInstallments,
        paidOnTime,
        paidLate,
        overdue: overdue.length,
        punctualityRate,
        completionRate,
        score: Math.round(score * 10) / 10,
        hasResolved: resolved.length > 0,
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results;
  }, [investments, installments]);

  const kpis = useMemo<TopClientesKPIs>(() => {
    const totalClientes = clientes.length;
    const mediaScore = totalClientes > 0
      ? Math.round(clientes.reduce((s, c) => s + c.score, 0) / totalClientes * 10) / 10
      : 0;
    const clientesPontuais = clientes.filter(c => c.score >= 70).length;
    const clientesRisco = clientes.filter(c => c.score < 40).length;
    return { totalClientes, mediaScore, clientesPontuais, clientesRisco };
  }, [clientes]);

  return { clientes, loading, error, kpis };
}
