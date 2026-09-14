import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef } from 'react';
import { Image } from 'expo-image';
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
const THUMB_GAP = 8;

interface Props {
    category: string;
    coverKey?: string;
    categoryLabel: string;
    images: any[];
    selectedIndex: number;
    onSelectIndex: (index: number) => void;
    hideTitle?: boolean;
}

export function PlanCoverPicker({ category, coverKey, categoryLabel: _categoryLabel, images, selectedIndex, onSelectIndex, hideTitle = false }: Props) {
    const { t } = useT();
    const listRef = useRef<FlatList>(null);
    const listKey = coverKey ?? category;
    const thumbScrollRef = useRef(false);
    const programmaticScrollRef = useRef(false);

    useEffect(() => {
        const idx = Math.max(0, Math.min(images.length - 1, selectedIndex));
        programmaticScrollRef.current = true;
        listRef.current?.scrollToOffset({ offset: idx * PREVIEW_W, animated: false });
        const tmr = setTimeout(() => {
            programmaticScrollRef.current = false;
        }, 80);
        return () => clearTimeout(tmr);
    }, [listKey, images.length, selectedIndex]);

    const onScrollEnd = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (thumbScrollRef.current || programmaticScrollRef.current) return;
            const idx = Math.round(e.nativeEvent.contentOffset.x / PREVIEW_W);
            const clamped = Math.max(0, Math.min(images.length - 1, idx));
            if (clamped !== selectedIndex) onSelectIndex(clamped);
        },
        [images.length, selectedIndex, onSelectIndex],
    );

    const pickThumb = (index: number) => {
        if (index === selectedIndex) return;
        thumbScrollRef.current = true;
        onSelectIndex(index);
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
        setTimeout(() => {
            thumbScrollRef.current = false;
        }, 350);
    };

    return (
        <View style={styles.wrap}>
            {hideTitle ? null : (
            <View style={styles.headerRow}>
                <Text style={styles.title}>{t('createplan.coverPhoto')}</Text>
            </View>
            )}

            <View style={styles.previewShadow}>
                <View style={styles.previewCard}>
                    <FlatList
                        ref={listRef}
                        key={listKey}
                        data={images}
                        horizontal
                        pagingEnabled
                        decelerationRate="fast"
                        snapToInterval={PREVIEW_W}
                        snapToAlignment="start"
                        showsHorizontalScrollIndicator={false}
                        extraData={selectedIndex}
                        keyExtractor={(_, i) => `${listKey}-${i}`}
                        onMomentumScrollEnd={onScrollEnd}
                        onScrollEndDrag={onScrollEnd}
                        getItemLayout={(_, index) => ({
                            length: PREVIEW_W,
                            offset: PREVIEW_W * index,
                            index,
                        })}
                        renderItem={({ item }) => (
                            <Image
                                source={typeof item === 'number' ? item : { uri: item }}
                                style={styles.previewImage}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                recyclingKey={`${listKey}-${String(item)}`}
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
                        <Text style={styles.swipeHintText}>{t('createplan.coverSwipe')}</Text>
                    </View>
                </View>
            </View>

            <View style={styles.thumbRow}>
                {images.map((img, i) => {
                    const active = i === selectedIndex;
                    const n = Math.max(images.length, 1);
                    const thumbSize = Math.floor(
                        (SCREEN_W - H_PAD * 2 - THUMB_GAP * (n - 1)) / n,
                    );
                    return (
                        <Pressable
                            key={`${listKey}-thumb-${i}`}
                            onPress={() => pickThumb(i)}
                            style={[
                                styles.thumbWrap,
                                { width: thumbSize, height: thumbSize },
                                active && styles.thumbWrapActive,
                            ]}
                        >
                            <Image
                                source={typeof img === 'number' ? img : { uri: img }}
                                style={styles.thumbImage}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                            />
                            {active && (
                                <View style={styles.thumbCheck}>
                                    <Ionicons name="checkmark" size={14} color="#FFF" />
                                </View>
                            )}
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingTop: 28,
        paddingBottom: 8,
        backgroundColor: '#F2F7FF',
        borderBottomWidth: 4,
        borderBottomColor: '#E8F0FE',
    },
    headerRow: {
        paddingHorizontal: H_PAD,
        marginBottom: 14,
    },
    title: { fontSize: 17, fontWeight: '800', color: INK, letterSpacing: -0.3 },
    previewShadow: {
        marginHorizontal: H_PAD,
        borderRadius: 24,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.22,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
    },
    previewCard: {
        width: PREVIEW_W,
        height: PREVIEW_H,
        borderRadius: 24,
        overflow: 'hidden',
        backgroundColor: '#CBD5E1',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.6)',
    },
    previewImage: { width: PREVIEW_W, height: PREVIEW_H },
    previewGradient: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: PREVIEW_H * 0.45,
    },
    swipeHint: {
        position: 'absolute',
        bottom: 14,
        right: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: 'rgba(0,0,0,0.35)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
    },
    swipeHintText: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '600' },
    thumbRow: {
        flexDirection: 'row',
        flexWrap: 'nowrap',
        gap: THUMB_GAP,
        paddingHorizontal: H_PAD,
        paddingTop: 16,
        paddingBottom: 20,
        justifyContent: 'flex-start',
        alignItems: 'center',
    },
    thumbWrap: {
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 2.5,
        borderColor: 'transparent',
        backgroundColor: '#E2E8F0',
        flexShrink: 0,
    },
    thumbWrapActive: {
        borderColor: PRIMARY_DARK,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.3,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
    },
    thumbImage: { width: '100%', height: '100%' },
    thumbCheck: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: PRIMARY_DARK,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#FFF',
    },
});
