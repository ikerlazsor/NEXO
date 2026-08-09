// Supabase Edge Function: expande búsquedas del feed (sinónimos + multidioma).
// Secret requerido: OPENAI_API_KEY
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const jsonHeaders = { ...cors, 'Content-Type': 'application/json' };
const MAX_QUERY_LENGTH = 120;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    try {
        const authHeader = req.headers.get('Authorization') ?? '';
        const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!accessToken) return json({ error: 'unauthorized' }, 401);

        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
        if (!supabaseUrl || !anonKey) return json({ error: 'server_misconfigured' }, 500);

        const supabase = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
            auth: { persistSession: false },
        });
        const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
        if (authError || !user) return json({ error: 'unauthorized' }, 401);

        const body = await req.json().catch(() => null);
        const query = typeof body?.query === 'string' ? body.query.trim() : '';
        if (query.length < 2) return json({ terms: [] });
        if (query.length > MAX_QUERY_LENGTH) return json({ error: 'query_too_long' }, 400);

        const { data: allowed, error: quotaError } = await supabase.rpc('consume_ai_search_quota');
        if (quotaError) {
            console.error('AI search quota error:', quotaError.message);
            return json({ error: 'quota_unavailable' }, 503);
        }
        if (allowed !== true) return json({ error: 'rate_limit_exceeded' }, 429);

        const apiKey = Deno.env.get('OPENAI_API_KEY');
        if (!apiKey) return json({ terms: [] });

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                temperature: 0.2,
                max_tokens: 220,
                messages: [
                    {
                        role: 'system',
                        content:
                            'You expand search queries for a Spanish social plans app (NEXO). '
                            + 'Given a user query in ANY language, return related keywords/synonyms in Spanish and English '
                            + 'that could match plan titles. Reply ONLY JSON: {"terms":["..."]}. '
                            + 'Maximum 18 short terms.',
                    },
                    { role: 'user', content: query },
                ],
            }),
        });

        if (!res.ok) {
            console.error('OpenAI response:', res.status);
            return json({ terms: [] });
        }

        const payload = await res.json();
        const rawText = payload?.choices?.[0]?.message?.content?.trim() || '';
        const match = rawText.match(/\{[\s\S]*\}/);
        let terms: string[] = [];
        if (match) {
            try {
                const parsed = JSON.parse(match[0]);
                if (Array.isArray(parsed.terms)) {
                    terms = parsed.terms
                        .map((term: unknown) => String(term).toLowerCase().trim())
                        .filter((term: string) => term.length >= 2 && term.length <= 60)
                        .slice(0, 18);
                }
            } catch {
                terms = [];
            }
        }

        return json({ terms });
    } catch (error) {
        console.error(error);
        return json({ terms: [] });
    }
});
