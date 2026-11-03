/**
 * Miniaturas de Storage.
 *
 * Las transforms (`/render/image`) se apagaron: el cupo Pro (100) se estaba
 * pasando y el proyecto podía ir a solo-lectura. expo-image recorta/cachea
 * en el cliente; las fotos se comprimen al subir.
 */

/** Marca de una URL pública de Storage. */
const PUBLIC_OBJECT_PATH = '/storage/v1/object/public/';
const RENDER_IMAGE_PATH = '/storage/v1/render/image/public/';

export const WEBP_ACCEPT_HEADERS = { Accept: 'image/webp,image/*;q=0.8' };

/**
 * Devuelve la URL de la foto. Ya no reescribe a `render/image` (cupo).
 * Si llega una URL vieja transformada, la deja en el original público.
 */
export function storageThumbUrl(
    url: string | null | undefined,
    _width?: number,
    _quality?: number,
): string | null | undefined {
    if (!url || typeof url !== 'string') return url;
    if (url.includes(RENDER_IMAGE_PATH)) {
        return url.replace(RENDER_IMAGE_PATH, PUBLIC_OBJECT_PATH).split('?')[0] ?? url;
    }
    return url;
}
