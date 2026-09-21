import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    Dimensions,
    FlatList,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useT } from '../lib/i18n';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';

const { width: SCREEN_W } = Dimensions.get('window');
const H_PAD = 20;
const PREVIEW_W = SCREEN_W - H_PAD * 2;
const PREVIEW_H = 248;
const THUMB = 60;
const THUMB_GAP = 10;
const LOOP_COPIES = 7;

interface Props {
    category: string;
    coverKey?: string;
    categoryLabel: string;
    images: any[];
    selectedIndex: number;
    onSelectIndex: (index: number) => void;
    hideTitle?: boolean;
}

export function PlanCoverPicker({
    category,
    coverKey,
    categoryLabel: _categoryLabel,
    images,
    selectedIndex,
    onSelectIndex,
    hideTitle = false,
}: Props) {
    const { t } = useT();
    const listRef = useRef<FlatList>(null);
    const listKey = coverKey ?? category;
    const thumbTapRef = useRef(false);
    const programmaticScrollRef = useRef(false);
    const n = Math.max(1, images.length);
    const midCopy = Math.floor(LOOP_COPIES / 2);

    const looped = useMemo(() => {
        if (images.length === 0) return [];
        const out: { src: any; real: number; key: string }[] = [];
        for (let copy = 0; copy < LOOP_COPIES; copy++) {
            images.forEach((src, real) => {
                out.push({ src, real, key: `${listKey}-${copy}-${real}` });
            });
        }
        return out;
    }, [images, listKey]);

    const absoluteIndex = (real: number) => midCopy * n + real;
    const ignoreScrollUntilRef = useRef(0);

    // Tras cambiar cat/sub, el FlatList se remonta; ignoramos scroll fantasma
    // que reescribía coverIndex un frame después.
    useEffect(() => {
        ignoreScrollUntilRef.current = Date.now() + 200;
        if (!looped.length) return;
        const idx = absoluteIndex(Math.max(0, Math.min(n - 1, selectedIndex)));
        programmaticScrollRef.current = true;
        requestAnimationFrame(() => {
            listRef.current?.scrollToOffset({ offset: idx * PREVIEW_W, animated: false });
            setTimeout(() => {
                programmaticScrollRef.current = false;
            }, 120);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listKey, n]);

    const recenterIfNeeded = useCallback(
        (raw: number, real: number) => {
            if (raw < n || raw >= n * (LOOP_COPIES - 1)) {
                programmaticScrollRef.current = true;
                listRef.current?.scrollToOffset({
                    offset: absoluteIndex(real) * PREVIEW_W,
                    animated: false,
                });
                setTimeout(() => {
                    programmaticScrollRef.current = false;
                }, 40);
            }
        },
        [n],
    );

    const onPreviewScrollEnd = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (thumbTapRef.current || programmaticScrollRef.current || n <= 0) return;
            if (Date.now() < ignoreScrollUntilRef.current) return;
            const raw = Math.round(e.nativeEvent.contentOffset.x / PREVIEW_W);
            const real = ((raw % n) + n) % n;
            if (real !== selectedIndex) onSelectIndex(real);
            recenterIfNeeded(raw, real);
        },
        [n, selectedIndex, onSelectIndex, recenterIfNeeded],
    );

    const pickThumb = (index: number) => {
        if (index === selectedIndex) return;
        thumbTapRef.current = true;
        onSelectIndex(index);
        programmaticScrollRef.current = true;
        listRef.current?.scrollToOffset({
            offset: absoluteIndex(index) * PREVIEW_W,
            animated: true,
        });
        setTimeout(() => {
            thumbTapRef.current = false;
            programmaticScrollRef.current = false;
        }, 350);
    };

    const safeIndex = Math.max(0, Math.min(n - 1, selectedIndex));
    const underlaySrc = images[safeIndex];

    return (
        <View style={styles.wrap}>
            {hideTitle ? null : (
                <View style={styles.headerRow}>
                    <Text style={styles.title}>{t('createplan.coverPhoto')}</Text>
                </View>
            )}

            <View style={styles.previewShadow}>
                <View style={styles.previewCard}>
                    {underlaySrc != null ? (
                        <Image
                            source={typeof underlaySrc === 'number' ? underlaySrc : { uri: underlaySrc }}
                            style={[styles.previewImage, StyleSheet.absoluteFillObject]}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            priority="high"
                            transition={0}
                        />
                    ) : null}
                    <FlatList
                        key={listKey}
                        ref={listRef}
                        data={looped}
                        horizontal
                        pagingEnabled
                        decelerationRate="fast"
                        snapToInterval={PREVIEW_W}
                        snapToAlignment="start"
                        disableIntervalMomentum
                        showsHorizontalScrollIndicator={false}
                        extraData={`${listKey}:${selectedIndex}`}
                        keyExtractor={(item) => item.key}
                        onMomentumScrollEnd={onPreviewScrollEnd}
                        onScrollEndDrag={onPreviewScrollEnd}
                        getItemLayout={(_, index) => ({
                            length: PREVIEW_W,
                            offset: PREVIEW_W * index,
                            index,
                        })}
                        initialScrollIndex={absoluteIndex(Math.max(0, Math.min(n - 1, selectedIndex)))}
                        renderItem={({ item }) => (
                            <Image
                                source={typeof item.src === 'number' ? item.src : { uri: item.src }}
                                style={styles.previewImage}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                recyclingKey={item.key}
                                priority="high"
                                transition={0}
                            />
                        )}
                    />

                    <LinearGradient
                        colors={['transparent', 'rgba(15, 42, 74, 0.75)']}
                        style={styles.previewGradient}
                        pointerEvents="none"
                    />

                    <View style={styles.swipeHint} pointerEvents="none">
                        <Ionicons name="swap-horizontal" size={14} color="rgba(255,255,255,0.85)" />
                        <Text style={styles.swipeHintText}>{t('createplan.coverPhotoSub')}</Text>
                    </View>
                </View>
            </View>

            <View style={styles.thumbsRow}>
                {images.map((img, index) => {
                    const active = index === selectedIndex;
                    return (
                        <Pressable
                            key={`${listKey}-thumb-${index}`}
                            onPress={() => pickThumb(index)}
                            style={[styles.thumbWrap, active && styles.thumbWrapActive]}
                        >
                            <Image
                                source={typeof img === 'number' ? img : { uri: img }}
                                style={styles.thumb}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                priority="high"
                                transition={0}
                            />
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { marginBottom: 8, marginTop: 10 },
    headerRow: {
        paddingHorizontal: H_PAD,
        marginBottom: 10,
        marginTop: 6,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    title: { fontSize: 16, fontWeight: '800', color: INK },
    previewShadow: {
        marginHorizontal: H_PAD,
        borderRadius: 22,
        shadowColor: '#0F172A',
        shadowOpacity: 0.14,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
    },
    previewCard: {
        width: PREVIEW_W,
        height: PREVIEW_H,
        borderRadius: 22,
        overflow: 'hidden',
        backgroundColor: '#E2E8F0',
    },
    previewImage: { width: PREVIEW_W, height: PREVIEW_H },
    previewGradient: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 72,
    },
    swipeHint: {
        position: 'absolute',
        bottom: 14,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(15,42,74,0.35)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
    },
    swipeHintText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
    thumbsRow: {
        marginTop: 12,
        paddingHorizontal: H_PAD,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: THUMB_GAP,
        justifyContent: 'center',
    },
    thumbWrap: {
        width: THUMB,
        height: THUMB,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: 'transparent',
    },
    thumbWrapActive: { borderColor: PRIMARY_DARK },
    thumb: { width: '100%', height: '100%' },
});
