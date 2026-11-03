import { type RefObject } from 'react';
import { Share, View } from 'react-native';
import { buildFootballShareMessage } from './shareLinks';
import { withShareTouchGuard } from './shareTouchGuard';
import type { FootballConfig, FootballOccupant } from './footballLineup';
import type { FootballSharePerson } from '../components/FootballShareCard';

export type FootballShareInput = {
    planId: string;
    title: string;
    location?: string | null;
    when?: string | null;
    spotsLeft: number;
    maxPeople: number;
    joinedCount: number;
    config: FootballConfig | null;
    slots: FootballOccupant[];
    people: FootballSharePerson[];
    formatLabel?: string | null;
    lang?: string;
};

export function footballShareCaption(input: Pick<FootballShareInput, 'planId'>): string {
    return buildFootballShareMessage({ planId: input.planId });
}

/**
 * Comparte el plan de fútbol (solo link).
 * La captura de cartel se desactivó: view-shot + share sheet tumbaban la app en iOS.
 */
export async function shareFootballCard(opts: {
    cardRef: RefObject<View | null>;
    input: FootballShareInput;
}): Promise<{ ok: boolean; error?: string }> {
    const message = footballShareCaption(opts.input);
    try {
        await withShareTouchGuard(() => Share.share({ message }));
        return { ok: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/User did not share|canceled|cancelled|dismiss/i.test(msg)) {
            return { ok: true };
        }
        return { ok: false, error: msg };
    }
}
