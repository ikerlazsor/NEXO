import { type RefObject } from 'react';
import { Platform, Share, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { buildFootballShareMessage } from './shareLinks';
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

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function footballShareCaption(input: Pick<FootballShareInput, 'planId'>): string {
    return buildFootballShareMessage({ planId: input.planId });
}

/**
 * Captura la tarjeta pachanga y abre el share sheet con copy corto.
 * `cardRef` debe apuntar al View de FootballShareCard ya montado y visible para layout.
 */
export async function shareFootballCard(opts: {
    cardRef: RefObject<View | null>;
    input: FootballShareInput;
}): Promise<{ ok: boolean; error?: string }> {
    const { cardRef, input } = opts;
    const message = footballShareCaption(input);

    try {
        // Layout + descarga de avatares (Image nativo) antes de capturar.
        await sleep(520);
        if (!cardRef.current) {
            await Share.share({ message });
            return { ok: true };
        }

        const uri = await captureRef(cardRef, {
            format: 'png',
            quality: 1,
            result: 'tmpfile',
        });

        if (Platform.OS === 'ios') {
            await Share.share({ url: uri, message });
        } else {
            // El cartel ya lleva «Quedan X plazas»; el caption corto aporta el link.
            await Share.share({ message, url: uri });
        }
        return { ok: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/User did not share|canceled|cancelled/i.test(msg)) {
            return { ok: true };
        }
        try {
            await Share.share({ message });
            return { ok: true };
        } catch {
            return { ok: false, error: msg };
        }
    }
}
