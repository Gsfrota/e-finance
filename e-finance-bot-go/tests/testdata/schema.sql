-- Schema local mínimo pro store/testes (subconjunto real de prod, extraído via MCP 10/07).
-- A bateria black-box (M3+) reusa isto + seeds por caso. NÃO é a fonte de verdade de prod.
create extension if not exists "uuid-ossp";

create table if not exists profiles (
  id uuid primary key,
  tenant_id uuid not null,
  email text,
  full_name text,
  role text default 'investor',
  whatsapp_phone text,
  telegram_chat_id text,
  auth_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists bot_sessions (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid,
  channel text not null,
  channel_user_id text not null,
  context jsonb default '{}'::jsonb,
  last_active_at timestamptz default now(),
  created_at timestamptz default now()
);
-- prod precisa deste índice (parte da migration pendente) pra get-or-create sem corrida.
create unique index if not exists bot_sessions_channel_user_uq on bot_sessions (channel, channel_user_id);

-- tabela nova da spec (dedup sobrevive a restart). Migration em prod exige aprovação.
create table if not exists bot_processed_updates (
  channel text not null,
  external_id text not null,
  processed_at timestamptz not null default now(),
  primary key (channel, external_id)
);
