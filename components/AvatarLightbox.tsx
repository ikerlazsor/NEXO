import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
    visible: boolean;
    uri?: string | null;
    name?: string;
    onClose: () => void;
};

export function AvatarLightbox({ visible, uri, name = 'U', onClose }: Props) {
    const insets = useSafeAreaInsets();
    const source =
        uri ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=E2E8F0&color=475569&size=512`;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.overlay} onPress={onClose}>
                <Pressable
                    style={[styles.closeBtn, { top: insets.top + 12 }]}
                    onPress={onClose}
                    hitSlop={12}
                >
                    <Ionicons name="close" size={28} color="#FFF" />
                </Pressable>
                <Pressable style={styles.imageWrap} onPress={(e) => e.stopPropagation()}>
                    <Image
                        source={{ uri: source }}
                        style={styles.image}
                        contentFit="contain"
                        cachePolicy="memory-disk"
                        transition={0}
                    />
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.92)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    closeBtn: {
        position: 'absolute',
        right: 20,
        zIndex: 2,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.15)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    imageWrap: {
        width: '92%',
        aspectRatio: 1,
        maxHeight: '70%',
    },
    image: {
        width: '100%',
        height: '100%',
        borderRadius: 16,
    },
});
