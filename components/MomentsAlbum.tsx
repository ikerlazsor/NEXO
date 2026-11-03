import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import {
    FlatList,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../lib/i18n';
import type { MomentItem } from '../lib/planMoments';

type Props = {
    items: MomentItem[] | null;
    onClose: () => void;
    onOpenImage: (uri: string) => void;
    onOpenVideo: (uri: string) => void;
};

export function MomentsAlbum({ items, onClose, onOpenImage, onOpenVideo }: Props) {
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const [live, setLive] = useState(true);
    const frameWidth = width - 24;

    useEffect(() => {
        if (items?.length) setLive(true);
    }, [items]);

    const close = useCallback(() => {
        setLive(false);
        requestAnimationFrame(() => onClose());
    }, [onClose]);

    return (
        <Modal
            visible={items != null}
            animationType="none"
            onRequestClose={close}
            statusBarTranslucent
        >
            <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
                <View style={styles.top}>
                    <Pressable onPress={close} hitSlop={12} style={styles.back}>
                        <Ionicons name="chevron-back" size={26} color="#F8FAFC" />
                    </Pressable>
                    <View style={styles.titles}>
                        <Text style={styles.title}>{t('chat.moments')}</Text>
                        <Text style={styles.count}>{items?.length ?? 0}</Text>
                    </View>
                </View>
                {live && items ? (
                    <FlatList
                        data={items}
                        keyExtractor={(item, index) => `${item.url}-${index}`}
                        contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 8 }}
                        initialNumToRender={2}
                        maxToRenderPerBatch={2}
                        windowSize={3}
                        removeClippedSubviews
                        renderItem={({ item }) => (
                            <Pressable
                                onPress={() => (item.type === 'video' ? onOpenVideo(item.url) : onOpenImage(item.url))}
                                style={[styles.frame, { width: frameWidth }]}
                            >
                                {item.type === 'image' ? (
                                    <Image
                                        source={{ uri: item.url }}
                                        style={styles.photo}
                                        contentFit="cover"
                                        cachePolicy="memory-disk"
                                        recyclingKey={item.url}
                                        transition={0}
                                    />
                                ) : (
                                    <View style={styles.video}>
                                        <View style={styles.play}>
                                            <Ionicons name="play" size={32} color="#0F2A4A" />
                                        </View>
                                        <Text style={styles.videoLabel}>{t('chat.videoLabel')}</Text>
                                    </View>
                                )}
                            </Pressable>
                        )}
                    />
                ) : null}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#07111F' },
    top: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingBottom: 10,
        gap: 4,
    },
    back: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    titles: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    title: { color: '#F8FAFC', fontSize: 22, fontWeight: '800' },
    count: { color: '#F8D48A', fontSize: 16, fontWeight: '800' },
    frame: {
        alignSelf: 'center',
        height: 420,
        borderRadius: 22,
        overflow: 'hidden',
        marginBottom: 14,
        backgroundColor: '#111827',
    },
    photo: { width: '100%', height: '100%' },
    video: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    play: {
        width: 76,
        height: 76,
        borderRadius: 38,
        backgroundColor: '#F8D48A',
        alignItems: 'center',
        justifyContent: 'center',
        paddingLeft: 4,
    },
    videoLabel: { color: '#F8FAFC', fontSize: 16, fontWeight: '700' },
});
