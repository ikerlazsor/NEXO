import { Image, ImageStyle } from 'expo-image';
import { useState } from 'react';
import { StyleProp } from 'react-native';
import { storageThumbUrl, WEBP_ACCEPT_HEADERS } from '../lib/storageImage';

const FALLBACK_URI = 'https://via.placeholder.com/400';

interface PlanImageProps {
    source?: string | number | null;
    style?: StyleProp<ImageStyle>;
    priority?: 'low' | 'normal' | 'high';
    recyclingKey?: string;
    /** Ancho en el que se ve. Sin esto se descarga el JPEG original completo. */
    thumbWidth?: number;
}

export function PlanImage({
    source,
    style,
    priority = 'normal',
    recyclingKey,
    thumbWidth,
}: PlanImageProps) {
    /** Si la miniatura del servidor falla, se cae al original en vez de dejar un hueco. */
    const [thumbFailed, setThumbFailed] = useState(false);

    const resolvedSource =
        source == null
            ? { uri: FALLBACK_URI }
            : typeof source === 'number'
              ? source
              : thumbWidth && !thumbFailed
                ? {
                      uri: storageThumbUrl(source, thumbWidth) ?? source,
                      width: thumbWidth,
                      height: thumbWidth,
                      headers: WEBP_ACCEPT_HEADERS,
                  }
                : { uri: source };

    const key =
        recyclingKey ?? (typeof source === 'string' ? source : undefined);

    return (
        <Image
            source={resolvedSource}
            style={style}
            contentFit="cover"
            cachePolicy="memory-disk"
            priority={priority}
            recyclingKey={key}
            transition={0}
            placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
            onError={thumbFailed ? undefined : () => setThumbFailed(true)}
        />
    );
}
