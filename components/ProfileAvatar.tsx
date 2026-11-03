import { Image as ExpoImage } from 'expo-image';
import { useState } from 'react';
import { Image as RnImage, StyleSheet, View } from 'react-native';
import { storageThumbUrl, WEBP_ACCEPT_HEADERS } from '../lib/storageImage';

interface Props {
    uri?: string | null;
    name?: string;
    size?: number;
    /** Por defecto círculo (size/2). Pasa un valor menor para cuadrado redondeado. */
    borderRadius?: number;
    recyclingKey?: string;
    priority?: 'low' | 'normal' | 'high';
    /** Miniatura ya en caché: se ve al instante mientras llega el tamaño grande. */
    placeholderUri?: string | null;
    /**
     * Para captura con view-shot: usa Image nativa (expo-image suele salir en gris).
     * Sin headers webp ni recycling.
     */
    snapshotFriendly?: boolean;
}

export function ProfileAvatar({
    uri,
    name = 'U',
    size = 100,
    borderRadius,
    recyclingKey,
    priority = 'high',
    placeholderUri,
    snapshotFriendly = false,
}: Props) {
    const source =
        uri ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=E2E8F0&color=475569&size=${size}`;
    const radius = borderRadius ?? size / 2;

    /** Si la miniatura del servidor falla, se cae a la foto original. */
    const [thumbFailed, setThumbFailed] = useState(false);
    const thumb = thumbFailed ? source : storageThumbUrl(source, size) ?? source;

    if (snapshotFriendly) {
        // URI original (no thumb webp): RN Image no manda los headers de WEBP.
        return (
            <View style={[styles.wrap, { width: size, height: size, borderRadius: radius }]}>
                <RnImage
                    source={{ uri: source }}
                    style={{ width: size, height: size, borderRadius: radius }}
                    resizeMode="cover"
                    fadeDuration={0}
                />
            </View>
        );
    }

    return (
        <View style={[styles.wrap, { width: size, height: size, borderRadius: radius }]}>
            <ExpoImage
                source={thumb === source ? { uri: source } : { uri: thumb, headers: WEBP_ACCEPT_HEADERS }}
                style={{ width: size, height: size, borderRadius: radius }}
                contentFit="cover"
                contentPosition="center"
                cachePolicy="memory-disk"
                priority={priority}
                recyclingKey={recyclingKey ?? uri ?? name}
                transition={0}
                placeholder={placeholderUri ? { uri: placeholderUri } : { blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
                onError={thumbFailed ? undefined : () => setThumbFailed(true)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#E2E8F0',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
