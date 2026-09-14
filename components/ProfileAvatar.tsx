import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

interface Props {
    uri?: string | null;
    name?: string;
    size?: number;
    recyclingKey?: string;
    priority?: 'low' | 'normal' | 'high';
}

export function ProfileAvatar({ uri, name = 'U', size = 100, recyclingKey, priority = 'high' }: Props) {
    const source = uri || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=E2E8F0&color=475569&size=${size}`;
    const radius = size / 2;

    return (
        <View style={[styles.wrap, { width: size, height: size, borderRadius: radius }]}>
            <Image
                source={{ uri: source }}
                style={{ width: size, height: size, borderRadius: radius }}
                contentFit="cover"
                contentPosition="center"
                cachePolicy="memory-disk"
                priority={priority}
                recyclingKey={recyclingKey ?? uri ?? name}
                transition={0}
                placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
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
