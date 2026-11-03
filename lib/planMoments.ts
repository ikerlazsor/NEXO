/** Un mensaje del chat que agrupa varias fotos y vídeos. */
export const MOMENTS_PREFIX = 'nexo_moments:v1:';

export type MomentItem = {
    url: string;
    type: 'image' | 'video';
};

export function encodeMoments(items: MomentItem[]): string {
    return MOMENTS_PREFIX + JSON.stringify(
        items
            .filter((item) => item.url)
            .map((item) => ({ u: item.url, t: item.type === 'video' ? 'video' : 'image' })),
    );
}

export function parseMoments(contenido: string | null | undefined): MomentItem[] | null {
    if (!contenido || !contenido.startsWith(MOMENTS_PREFIX)) return null;
    try {
        const raw = JSON.parse(contenido.slice(MOMENTS_PREFIX.length)) as { u?: string; t?: string }[];
        if (!Array.isArray(raw)) return null;
        const items = raw
            .filter((item) => typeof item?.u === 'string' && item.u.length > 0)
            .map((item) => ({
                url: item.u as string,
                type: item.t === 'video' ? 'video' as const : 'image' as const,
            }));
        return items.length ? items : null;
    } catch {
        return null;
    }
}
