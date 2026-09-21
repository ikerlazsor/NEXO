import { Asset } from 'expo-asset';
import { Image } from 'expo-image';
import { InteractionManager } from 'react-native';
import {
    MAIN_CATEGORY_IDS,
    PLACEHOLDER_COVER_URI,
    SUBCATEGORIES,
    getCoverImages,
    type MainCategoryId,
} from './categories';

let started = false;

/** Precarga en disco/memoria todas las portadas de crear plan (misma caché que PlanImage). */
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

            await Promise.allSettled(remote.map((uri) => Image.prefetch(uri)));
        })();
    });
}

/** Precarga inmediata las portadas de una categoría/subcategoría (crear plan). */
export function warmCoverImages(main: MainCategoryId, sub: string): void {
    const images = getCoverImages(main, sub);
    const modules: number[] = [];
    const remote: string[] = [];
    for (const src of images) {
        if (typeof src === 'number') modules.push(src);
        else if (typeof src === 'string' && src.startsWith('http')) remote.push(src);
    }
    if (modules.length) {
        void Asset.loadAsync(modules);
    }
    if (remote.length) {
        void Promise.allSettled(remote.map((uri) => Image.prefetch(uri)));
    }
}

/** Precarga URLs remotas (portadas/avatares del feed) en la caché de expo-image. */
export function prefetchRemoteImages(uris: Array<string | null | undefined>, limit = 24): void {
    const unique = [...new Set(uris.filter((u): u is string => typeof u === 'string' && u.startsWith('http')))].slice(
        0,
        limit,
    );
    if (!unique.length) return;
    InteractionManager.runAfterInteractions(() => {
        void Promise.allSettled(unique.map((uri) => Image.prefetch(uri)));
    });
}
