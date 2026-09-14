import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

export type ImageCompressPreset = 'avatar' | 'cover' | 'moment' | 'plan';

const PRESETS: Record<
    ImageCompressPreset,
    { maxEdge: number; quality: number; /** Si ya pesa menos, no tocar (evita el cuello de ImageManipulator). */ skipBelowBytes: number }
> = {
    avatar: { maxEdge: 640, quality: 0.62, skipBelowBytes: 280_000 },
    cover: { maxEdge: 1200, quality: 0.62, skipBelowBytes: 450_000 },
    moment: { maxEdge: 1080, quality: 0.6, skipBelowBytes: 400_000 },
    plan: { maxEdge: 1080, quality: 0.58, skipBelowBytes: 220_000 },
};

function getImageSize(uri: string): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
        Image.getSize(
            uri,
            (width, height) => resolve({ width, height }),
            () => resolve(null),
        );
    });
}

async function fileSizeBytes(uri: string): Promise<number> {
    try {
        const info = await FileSystem.getInfoAsync(uri, { size: true });
        if (info.exists && 'size' in info && typeof info.size === 'number') return info.size;
    } catch {
        // ignore
    }
    return 0;
}

/**
 * Comprime solo si hace falta. Un solo paso (ImageManipulator es lento en fotos grandes).
 */
export async function compressImageForUpload(
    uri: string,
    preset: ImageCompressPreset = 'moment',
): Promise<string> {
    const { maxEdge, quality, skipBelowBytes } = PRESETS[preset];
    try {
        const size = await fileSizeBytes(uri);
        if (size > 0 && size <= skipBelowBytes) return uri;

        const dims = await getImageSize(uri);
        if (dims && Math.max(dims.width, dims.height) <= maxEdge && size > 0 && size <= skipBelowBytes * 1.6) {
            return uri;
        }

        const actions =
            dims && dims.height > dims.width
                ? [{ resize: { height: maxEdge } }]
                : [{ resize: { width: maxEdge } }];

        const result = await manipulateAsync(uri, actions, {
            compress: quality,
            format: SaveFormat.JPEG,
        });
        return result.uri || uri;
    } catch (e) {
        console.warn('compressImageForUpload:', e);
        return uri;
    }
}
