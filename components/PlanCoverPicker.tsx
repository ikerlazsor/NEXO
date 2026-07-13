import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef } from 'react';
import {
    Dimensions,
    FlatList,
    Image,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useT } from '../lib/i18n';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';

const { width: SCREEN_W } = Dimensions.get('window');
const H_PAD = 20;
const PREVIEW_W = SCREEN_W - H_PAD * 2;
const PREVIEW_H = 248;
const THUMB = 72;

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
    Deporte: 'fitness',
    Fiesta: 'sparkles',
    'Solo chicas': 'female',
    Estudio: 'book',
    Tapas: 'restaurant',
    'Fútbol': 'football',
};

interface Props {
    category: string;
    coverKey?: string;
    categoryLabel: string;
    images: any[];
    selectedIndex: number;
    onSelectIndex: (index: number) => void;
}

export function PlanCoverPicker({ category, coverKey, categoryLabel, images, selectedIndex, onSelectIndex }: Props) {
    const { t } = useT();
    const listRef = useRef<FlatList>(null);
    const listKey = coverKey ?? category;
    const thumbScrollRef = useRef(false);

    useEffect(() => {
        const idx = Math.max(0, Math.min(images.length - 1, selectedIndex));
        listRef.current?.scrollToOffset({ offset: idx * PREVIEW_W, animated: false });
    }, [listKey, images.length]);

    const onScrollEnd = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (thumbScrollRef.current) return;
            const idx = Math.round(e.nativeEvent.contentOffset.x / PREVIEW_W);
            const clamped = Math.max(0, Math.min(images.length - 1, idx));
            if (clamped !== selectedIndex) onSelectIndex(clamped);
        },
        [images.length, selectedIndex, onSelectIndex]
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

    const icon = CATEGORY_ICONS[category] ?? 'image';

    return (
        <View style={styles.wrap}>
            <View style={styles.headerRow}>
                <View>
                    <Text style={styles.title}>{t('createplan.coverPhoto')}</Text>
                    <Text style={styles.subtitle}>{t('createplan.coverPhotoSub')}</Text>
                </View>
                <View style={styles.counterPill}>
                    <Text style={styles.counterText}>
                        {t('createplan.coverPhotoOf', { current: selectedIndex + 1, total: images.length })}
                    </Text>
                </View>
            </View>

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
                            <Image source={item} style={styles.previewImage} resizeMode="cover" />
                        )}
                    />

                    <LinearGradient
                        colors={['transparent', 'rgba(15, 42, 74, 0.75)']}
                        style={styles.previewGradient}
                        pointerEvents="none"
                    />

                    <View style={styles.previewBadge} pointerEvents="none">
                        <View style={styles.categoryChip}>
                            <Ionicons name={icon} size={14} color="#FFF" />
                            <Text style={styles.categoryChipText}>{categoryLabel}</Text>
                        </View>
                    </View>

                    <View style={styles.swipeHint} pointerEvents="none">
                        <Ionicons name="swap-horizontal" size={14} color="rgba(255,255,255,0.85)" />
                        <Text style={styles.swipeHintText}>{t('createplan.coverSwipe')}</Text>
                    </View>
                </View>
            </View>

            <View style={styles.thumbRow}>
                {images.map((img, i) => {
                    const active = i === selectedIndex;
                    return (
                        <Pressable
                            key={`${listKey}-thumb-${i}`}
                            onPress={() => pickThumb(i)}
                            style={[styles.thumbWrap, active && styles.thumbWrapActive]}
                        >
                            <Image source={img} style={styles.thumbImage} resizeMode="cover" />
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
        paddingTop: 8,
        paddingBottom: 4,
        backgroundColor: '#F2F7FF',
        borderBottomWidth: 4,
        borderBottomColor: '#E8F0FE',
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingHorizontal: H_PAD,
        marginBottom: 14,
        gap: 12,
    },
    title: { fontSize: 17, fontWeight: '800', color: INK, letterSpacing: -0.3 },
    subtitle: { fontSize: 13, color: '#64748B', marginTop: 4, lineHeight: 18 },
    counterPill: {
        backgroundColor: '#FFF',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#E3ECFB',
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.08,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
    counterText: { fontSize: 12, fontWeight: '800', color: PRIMARY_DARK },
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
    previewBadge: { position: 'absolute', top: 14, left: 14 },
    categoryChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(37, 99, 235, 0.88)',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
    },
    categoryChipText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
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
        flexWrap: 'wrap',
        gap: 10,
        paddingHorizontal: H_PAD,
        paddingTop: 16,
        paddingBottom: 20,
        justifyContent: 'center',
    },
    thumbWrap: {
        width: THUMB,
        height: THUMB,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 2.5,
        borderColor: 'transparent',
        backgroundColor: '#E2E8F0',
    },
    thumbWrapActive: {
        borderColor: PRIMARY_DARK,
        transform: [{ scale: 1.04 }],
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
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
