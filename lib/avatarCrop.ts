import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export type AvatarCropResult = {
    originX: number;
    originY: number;
    size: number;
};

/** Recorta un cuadrado en píxeles de la imagen original y lo deja listo para subir. */
export async function cropAvatarToSquare(
    uri: string,
    crop: AvatarCropResult,
): Promise<string> {
    const size = Math.max(1, Math.round(crop.size));
    const originX = Math.max(0, Math.round(crop.originX));
    const originY = Math.max(0, Math.round(crop.originY));

    const result = await manipulateAsync(
        uri,
        [
            {
                crop: {
                    originX,
                    originY,
                    width: size,
                    height: size,
                },
            },
            { resize: { width: 640 } },
        ],
        { compress: 0.85, format: SaveFormat.JPEG },
    );
    return result.uri;
}
