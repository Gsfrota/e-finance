begin;

-- 1. Saneia legado: mantém apenas uma parcela por (investment_id, number).
with ranked as (
  select
    id,
    row_number() over (
      partition by investment_id, number
      order by
        case status
          when 'paid' then 3
          when 'partial' then 2
          when 'late' then 1
          else 0
        end desc,
        coalesce(updated_at, created_at, now()) desc,
        id desc
    ) as rn
  from public.loan_installments
)
delete from public.loan_installments li
using ranked r
where li.id = r.id
  and r.rn > 1;

-- 2. Remove o gerador redundante.
-- Assumption validada no código: app e bot criam contratos via create_investment_validated,
-- não por insert direto em public.investments.
drop trigger if exists on_investment_created_generate_installments on public.investments;

-- 3. Trava estrutural para impedir retorno silencioso.
create unique index if not exists uq_loan_installments_investment_number
  on public.loan_installments (investment_id, number);

commit;
