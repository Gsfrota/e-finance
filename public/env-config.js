// Runtime environment config — sobrescrito em produção pelo docker-entrypoint.sh
// com as credenciais reais do Cloud Run (SUPABASE_URL / SUPABASE_ANON_KEY).
// Em dev local, use .env.local com VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
window._env_ = {
  SUPABASE_URL: "https://enzgerrnlbiojkuzeilw.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuemdlcnJubGJpb2prdXplaWx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MzIzMzgsImV4cCI6MjA4NDUwODMzOH0.Aka_UfDCUdJ1t0_MAy3HxIZngo3kNOv7eDTJPDhgl4o"
};
