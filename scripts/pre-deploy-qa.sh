#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

if [ "${PRE_DEPLOY_SKIP:-}" = "1" ]; then
  echo -e "${YELLOW}⚠️  QA pre-deploy pulado (PRE_DEPLOY_SKIP=1)${NC}"
  exit 0
fi

echo -e "\n${CYAN}═══════════════════════════════════════${NC}"
echo -e "${CYAN}  Pipeline QA Pre-Deploy               ${NC}"
echo -e "${CYAN}═══════════════════════════════════════${NC}\n"

# 1. Type check
echo -e "${YELLOW}▶ Type check (tsc --noEmit)...${NC}"
if ! npx tsc --noEmit; then
  echo -e "${RED}✗ Type check falhou. Corrija os erros antes do deploy.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Type check passou${NC}"

# 2. Análise de diff
echo -e "\n${YELLOW}▶ Analisando diff...${NC}"
ANALYSIS=$(npx tsx scripts/qa/analyze-diff.ts)

# 3. Auditoria de inputs (se alterados)
echo -e "\n${YELLOW}▶ Verificando inputs alterados...${NC}"
INPUT_AUDIT=$(echo "$ANALYSIS" | npx tsx scripts/qa/audit-inputs.ts)
INPUT_SKIP=$(echo "$INPUT_AUDIT" | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf-8'));
  console.log(d.skip ? 'skip' : d.hasBlockingGaps ? 'blocked' : 'ok');
")

if [ "$INPUT_SKIP" = "skip" ]; then
  echo -e "${GREEN}✓ Nenhum componente com inputs foi alterado${NC}"
elif [ "$INPUT_SKIP" = "blocked" ]; then
  echo -e "${RED}✗ Gaps de validação detectados em inputs. Verificar relatório acima.${NC}"
  if [ -t 0 ]; then
    read -p "Continuar mesmo assim? [y/N] " resp
    [[ ! "$resp" =~ ^[yY] ]] && exit 1
  else
    exit 1
  fi
else
  echo -e "${GREEN}✓ Inputs auditados com sucesso${NC}"
fi

# 4. Gera plano
echo "$ANALYSIS" | npx tsx scripts/qa/generate-plan.ts

# 5. Verifica se há testes para rodar
STATIC_TESTS=$(echo "$ANALYSIS" | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf-8'));
  const has=d.affectedFlows.some(f=>f.hasTests);
  console.log(has?'yes':'no');
")

if [ "$STATIC_TESTS" = "no" ]; then
  echo -e "\n${GREEN}✓ Nenhum teste automatizado necessário. Pipeline aprovada.${NC}"
  # Still run report for warnings
  npx tsx scripts/qa/run-tests.ts
  npx tsx scripts/qa/report.ts
  exit $?
fi

# 6. Prompt interativo
if [ -t 0 ]; then
  echo ""
  read -p "Prosseguir com os testes? [Y/n/skip] " resp
  case "$resp" in
    [nN]*) echo -e "${RED}Abortado pelo usuário.${NC}"; exit 1 ;;
    [sS]*) echo -e "${YELLOW}Testes pulados.${NC}"; exit 0 ;;
  esac
fi

# 7. Executa testes
echo -e "\n${YELLOW}▶ Executando testes E2E...${NC}"
npx tsx scripts/qa/run-tests.ts

# 8. Relatório + gate
npx tsx scripts/qa/report.ts
