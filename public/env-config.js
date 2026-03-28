// Runtime environment config — sobrescrito em produção pelo docker-entrypoint.sh
// com as credenciais reais do Cloud Run (SUPABASE_URL / SUPABASE_ANON_KEY).
// Em dev local, use .env.local com VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
window._env_ = {
  SUPABASE_URL: "SUPABASE_PROJECT_URL_REMOVED",
  SUPABASE_ANON_KEY: "SUPABASE_ANON_KEY_REMOVED"
};
