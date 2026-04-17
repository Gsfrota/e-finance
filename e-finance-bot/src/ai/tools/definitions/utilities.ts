import { z } from 'zod';
import type { ToolDefinition } from '../types';
import {
  greetHandler,
  helpHandler,
  smalltalkIdentityHandler,
  smalltalkDatetimeHandler,
} from '../handlers';

export const greetTool: ToolDefinition = {
  name: 'greet',
  kind: 'utility',
  description: 'Responde a saudações do usuário. Só use se o usuário apenas cumprimentou (ex: "oi", "olá", "bom dia") sem pedir nada. Mensagens de saudação geralmente são resolvidas pelo fast-path ANTES do LLM — você raramente vai ver essas.',
  rolesAllowed: ['admin', 'investor', 'debtor'],
  requiresConfirmation: false,
  fastPathEligible: true,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: greetHandler,
};

export const helpTool: ToolDefinition = {
  name: 'help',
  kind: 'utility',
  description: 'Lista as capacidades disponíveis para o usuário atual baseado no papel (admin/investor/debtor). Use para "o que você faz?", "ajuda", "help", "comandos".',
  rolesAllowed: ['admin', 'investor', 'debtor'],
  requiresConfirmation: false,
  fastPathEligible: true,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: helpHandler,
};

export const smalltalkIdentityTool: ToolDefinition = {
  name: 'smalltalk_identity',
  kind: 'utility',
  description: 'Responde "quem é você?". O LLM deve responder usando a persona do tenant (nome, tom) sem chamar esta tool. Existe como fallback.',
  rolesAllowed: ['admin', 'investor', 'debtor'],
  requiresConfirmation: false,
  fastPathEligible: false,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: smalltalkIdentityHandler,
};

export const smalltalkDatetimeTool: ToolDefinition = {
  name: 'smalltalk_datetime',
  kind: 'utility',
  description: 'Responde "que horas são?" / "que dia é hoje?". O LLM já recebe a data atual no system prompt e deve responder sem chamar esta tool.',
  rolesAllowed: ['admin', 'investor', 'debtor'],
  requiresConfirmation: false,
  fastPathEligible: false,
  parameters: { type: 'object', properties: {} },
  inputSchema: z.object({}).passthrough(),
  handler: smalltalkDatetimeHandler,
};

export const utilityTools: ToolDefinition[] = [
  greetTool,
  helpTool,
  smalltalkIdentityTool,
  smalltalkDatetimeTool,
];
