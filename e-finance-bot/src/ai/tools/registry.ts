import type { ActionCapability } from '../../assistant/contracts';
import type { GeminiFunctionDeclaration, ToolDefinition } from './types';
import { queryTools } from './definitions/queries';
import { mutationTools } from './definitions/mutations';
import { utilityTools } from './definitions/utilities';

const ALL_TOOLS: ToolDefinition[] = [
  ...queryTools,
  ...mutationTools,
  ...utilityTools,
];

const REGISTRY_BY_NAME: Map<ActionCapability, ToolDefinition> = new Map(
  ALL_TOOLS.map(t => [t.name, t]),
);

export function getTool(name: ActionCapability): ToolDefinition | undefined {
  return REGISTRY_BY_NAME.get(name);
}

export function getAllTools(): ToolDefinition[] {
  return ALL_TOOLS;
}

export function getToolsByRole(role: 'admin' | 'investor' | 'debtor'): ToolDefinition[] {
  return ALL_TOOLS.filter(t => t.rolesAllowed.includes(role));
}

export function getFunctionDeclarationsByRole(
  role: 'admin' | 'investor' | 'debtor',
): GeminiFunctionDeclaration[] {
  return getToolsByRole(role).map(toFunctionDeclaration);
}

export function toFunctionDeclaration(tool: ToolDefinition): GeminiFunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

export function getFastPathEligibleCapabilities(): Set<ActionCapability> {
  return new Set(ALL_TOOLS.filter(t => t.fastPathEligible).map(t => t.name));
}

export function getToolCount(): number {
  return ALL_TOOLS.length;
}
