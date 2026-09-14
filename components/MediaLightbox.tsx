import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Dimensions,
    FlatList,
    Modal,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type LightboxMedia = {
    url: string;
    kind: 'image' | 'video';
    thumb?: string | null;
};

type Props = {
    visible: boolean;
    uri?: string | null;
    kind?: 'image' | 'video';
    items?: LightboxMedia[];
    initialIndex?: number;
    onClose: () => void;
};

const SCREEN_W = Dimensions.get('window').width;

export function MediaLightbox({
    visible,
    uri,
    kind = 'image',
    items,
    initialIndex = 0,
    onClose,
}: Props) {
    const insets = useSafeAreaInsets();
    const listRef = useRef<FlatList<LightboxMedia>>(null);
    const slides = useMemo<LightboxMedia[]>(() => {
        if (items && items.length) return items.filter((item) => !!item.url);
        if (uri) return [{ url: uri, kind }];
        return [];
    }, [items, uri, kind]);
    const startIndex = Math.max(0, Math.min(initialIndex, Math.max(0, slides.length - 1)));
    const [page, setPage] = useState(startIndex);

    useEffect(() => {
        if (!visible || !slides.length) return;
        setPage(startIndex);
        const id = requestAnimationFrame(() => {
            listRef.current?.scrollToIndex({ index: startIndex, animated: false });
        });
        return () => cancelAnimationFrame(id);
    }, [visible, startIndex, slides.length]);

    const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const next = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
        const clamped = Math.max(0, Math.min(slides.length - 1, next));
        if (clamped !== page) setPage(clamped);
    };

    if (!slides.length) return null;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable
                    style={[styles.closeBtn, { top: insets.top + 12 }]}
                    onPress={onClose}
                    hitSlop={12}
                >
                    <Ionicons name="close" size={28} color="#FFF" />
                </Pressable>
                <FlatList
                    ref={listRef}
                    data={slides}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    keyExtractor={(item, i) => `${item.url}-${i}`}
                    getItemLayout={(_, index) => ({
                        length: SCREEN_W,
                        offset: SCREEN_W * index,
                        index,
                    })}
                    extraData={page}
                    initialScrollIndex={startIndex}
                    onMomentumScrollEnd={onScrollEnd}
                    onScrollEndDrag={onScrollEnd}
                    renderItem={({ item, index }) => (
                        <View style={styles.page}>
                            {item.kind === 'video' ? (
                                <Video
                                    source={{ uri: item.url }}
                                    style={styles.media}
                                    resizeMode={ResizeMode.CONTAIN}
                                    useNativeControls
                                    shouldPlay={visible && index === page}
                                    isLooping={false}
                                    progressUpdateIntervalMillis={500}
                                    posterSource={item.thumb ? { uri: item.thumb } : undefined}
                                    usePoster={!!item.thumb}
                                    posterStyle={styles.media}
                                />
                            ) : (
                                <Image
                                    source={{ uri: item.url }}
                                    style={styles.media}
                                    contentFit="contain"
                                    cachePolicy="memory-disk"
                                />
                            )}
                        </View>
                    )}
                />
                {slides.length > 1 ? (
                    <View style={[styles.counter, { bottom: insets.bottom + 18 }]} pointerEvents="none">
                        <Text style={styles.counterText}>{page + 1} / {slides.length}</Text>
                    </View>
                ) : null}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.92)',
        justifyContent: 'center',
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
    page: {
        width: SCREEN_W,
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 88,
    },
    media: {
        width: '100%',
        height: '100%',
        borderRadius: 16,
    },
    counter: {
        position: 'absolute',
        alignSelf: 'center',
        backgroundColor: 'rgba(0,0,0,0.45)',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    counterText: {
        color: '#FFF',
        fontWeight: '800',
        fontSize: 13,
    },
});
