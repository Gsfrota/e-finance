// Runtime environment config
// Em produção este arquivo é SOBRESCRITO pelo docker-entrypoint.sh
// com as credenciais reais do Cloud Run (SUPABASE_URL / SUPABASE_KEY).
// Em dev local, use localStorage ou .env.local com VITE_SUPABASE_URL.
window._env_ = {
  SUPABASE_URL: "",
  SUPABASE_KEY: ""
};
