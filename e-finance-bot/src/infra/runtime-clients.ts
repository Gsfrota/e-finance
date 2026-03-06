import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';

let supabaseClient: SupabaseClient | null = null;
let geminiClient: GoogleGenAI | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  }
  return supabaseClient;
}

export function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  }
  return geminiClient;
}

export function hasGeminiClient(): boolean {
  return !!config.gemini.apiKey;
}

