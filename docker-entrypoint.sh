#!/bin/sh
# Gera env-config.js com as credenciais do Cloud Run em runtime
# As variáveis SUPABASE_URL e SUPABASE_KEY vêm dos secrets do Cloud Run.

cat > /usr/share/nginx/html/env-config.js << EOF
window._env_ = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_KEY: "${SUPABASE_KEY}"
};
EOF

echo "[entrypoint] env-config.js gerado — URL: ${SUPABASE_URL:0:40}..."

exec nginx -g "daemon off;"
