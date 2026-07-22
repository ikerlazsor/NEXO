// Supabase Edge Function: expande búsquedas del feed (sinónimos + multidioma).
// Secret requerido: OPENAI_API_KEY
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors });
    }

    try {
        const apiKey = Deno.env.get('OPENAI_API_KEY');
        if (!apiKey) {
            return new Response(JSON.stringify({ terms: [] }), {
                status: 200,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        const { query } = await req.json();
        if (!query || typeof query !== 'string' || query.trim().length < 2) {
            return new Response(JSON.stringify({ terms: [] }), {
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

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
                            + 'that could match plan titles (e.g. "jiu jitsu brasileño" → open mat, bjj, grappling; '
                            + '"fortnite" → videojuegos, gaming). '
                            + 'Reply ONLY JSON: {"terms":["..."]}. Max 18 short terms.',
                    },
                    { role: 'user', content: query.trim() },
                ],
            }),
        });

        if (!res.ok) {
            return new Response(JSON.stringify({ terms: [] }), {
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        const json = await res.json();
        const text = json?.choices?.[0]?.message?.content?.trim() || '';
        const match = text.match(/\{[\s\S]*\}/);
        let terms: string[] = [];
        if (match) {
            try {
                const parsed = JSON.parse(match[0]);
                if (Array.isArray(parsed.terms)) {
                    terms = parsed.terms.map((t: unknown) => String(t).toLowerCase().trim()).filter((t: string) => t.length >= 2).slice(0, 18);
                }
            } catch {
                terms = [];
            }
        }

        return new Response(JSON.stringify({ terms }), {
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    } catch (e) {
        console.error(e);
        return new Response(JSON.stringify({ terms: [] }), {
            status: 200,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }
});
