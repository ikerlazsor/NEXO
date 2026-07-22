import { Asset } from 'expo-asset';
import { Image, InteractionManager } from 'react-native';
import {
    MAIN_CATEGORY_IDS,
    PLACEHOLDER_COVER_URI,
    SUBCATEGORIES,
    getCoverImages,
} from './categories';

let started = false;

/** Precarga en disco/memoria todas las portadas de crear plan. */
export function scheduleCoverPrefetch(): void {
    if (started) return;
    started = true;

    InteractionManager.runAfterInteractions(() => {
        void (async () => {
            const modules: number[] = [];
            const remote: string[] = [];

            for (const main of MAIN_CATEGORY_IDS) {
                for (const sub of SUBCATEGORIES[main]) {
                    for (const src of getCoverImages(main, sub)) {
                        if (typeof src === 'number') modules.push(src);
                        else if (typeof src === 'string' && src.startsWith('http')) remote.push(src);
                    }
                }
            }
            if (!remote.includes(PLACEHOLDER_COVER_URI)) {
                remote.push(PLACEHOLDER_COVER_URI);
            }

            const CHUNK = 10;
            for (let i = 0; i < modules.length; i += CHUNK) {
                try {
                    await Asset.loadAsync(modules.slice(i, i + CHUNK));
                } catch {
                    // best effort
                }
            }

            await Promise.allSettled(
                remote.map((uri) => Image.prefetch(uri)),
            );
        })();
    });
}
