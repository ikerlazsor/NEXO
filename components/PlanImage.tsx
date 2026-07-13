import { Image, ImageStyle } from 'expo-image';
import { StyleProp } from 'react-native';

const FALLBACK_URI = 'https://via.placeholder.com/400';

interface PlanImageProps {
    source?: string | number | null;
    style?: StyleProp<ImageStyle>;
    priority?: 'low' | 'normal' | 'high';
    recyclingKey?: string;
}

export function PlanImage({
    source,
    style,
    priority = 'normal',
    recyclingKey,
}: PlanImageProps) {
    const resolvedSource =
        source == null
            ? { uri: FALLBACK_URI }
            : typeof source === 'number'
              ? source
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
            transition={150}
            placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
        />
    );
}
