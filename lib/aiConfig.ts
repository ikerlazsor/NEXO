/**
 * Configuración de IA.
 * Preferible: secret OPENAI_API_KEY en Supabase Edge Functions.
 * Alternativa local/dev: EXPO_PUBLIC_OPENAI_API_KEY en .env
 */
export function getClientOpenAiKey(): string | null {
    const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    if (typeof key === 'string' && key.trim().length > 10) return key.trim();
    return null;
}

export function hasClientOpenAiKey(): boolean {
    return !!getClientOpenAiKey();
}
