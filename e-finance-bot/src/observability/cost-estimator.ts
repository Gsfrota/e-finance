// Gemini 2.5 Flash Lite pricing (March 2025)
const INPUT_COST_PER_M_USD = 0.075;   // $0.075 per 1M input tokens
const OUTPUT_COST_PER_M_USD = 0.30;   // $0.30 per 1M output tokens

export function estimateCostUsd(tokensInput: number, tokensOutput: number): number {
  return (tokensInput / 1_000_000) * INPUT_COST_PER_M_USD
    + (tokensOutput / 1_000_000) * OUTPUT_COST_PER_M_USD;
}
