#!/bin/sh
# Gera env-config.js com as credenciais do Cloud Run em runtime
# O caminho oficial é SUPABASE_URL + SUPABASE_ANON_KEY.
# Durante a transição, SUPABASE_KEY continua aceito como fallback legado.

RUNTIME_SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-${SUPABASE_KEY:-}}"

cat > /usr/share/nginx/html/env-config.js << EOF
window._env_ = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_ANON_KEY: "${RUNTIME_SUPABASE_ANON_KEY}",
  SUPABASE_KEY: "${RUNTIME_SUPABASE_ANON_KEY}"
};
EOF

echo "[entrypoint] env-config.js gerado — URL: ${SUPABASE_URL:0:40}..."

exec nginx -g "daemon off;"
