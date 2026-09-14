import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Dimensions,
    InteractionManager,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import { PlanImage } from './PlanImage';
import { resolvePlanImageSource } from '../lib/sports';
import { useTabPagerScroll } from '../lib/tabPagerScroll';

type Props = {
    covers: string[];
    fallback?: string | null;
    height: number;
    /** Ancho en px. Evita `width: '100%'` (Yoga se cuelga con JPEGs grandes). */
    width?: number;
    recyclingKey?: string;
    priority?: 'high' | 'normal' | 'low';
    onPress?: () => void;
    /** Separación inferior de los dots (p. ej. más alto bajo el título del detalle). */
    dotsBottom?: number;
    /**
     * En el feed: montar solo la 1ª foto al inicio y el resto tras idle.
     * Evita congelar FlashList al crear planes con varias portadas.
     */
    deferExtraSlides?: boolean;
};

const SCREEN_W = Dimensions.get('window').width;

export function PlanCoverCarousel({
    covers,
    fallback,
    height,
    width: widthProp,
    recyclingKey,
    priority = 'normal',
    onPress,
    dotsBottom = 10,
    deferExtraSlides = false,
}: Props) {
    const list = useMemo(
        () => (covers.length > 0 ? covers : fallback ? [fallback] : []),
        [covers, fallback],
    );
    const width = Math.max(1, Math.round(widthProp ?? SCREEN_W));
    const [index, setIndex] = useState(0);
    const [extrasReady, setExtrasReady] = useState(!deferExtraSlides || list.length <= 1);
    const scrollRef = useRef<ScrollView>(null);
    const { lockTabPager, unlockTabPager } = useTabPagerScroll();
    const safeIndex = list.length === 0 ? 0 : Math.min(index, list.length - 1);
    const resetKey = recyclingKey ?? '';

    useEffect(() => {
        setIndex(0);
        scrollRef.current?.scrollTo({ x: 0, animated: false });
    }, [resetKey]);

    useEffect(() => {
        if (!deferExtraSlides || list.length <= 1) {
            setExtrasReady(true);
            return;
        }
        setExtrasReady(false);
        const task = InteractionManager.runAfterInteractions(() => {
            setExtrasReady(true);
        });
        const fallback = setTimeout(() => setExtrasReady(true), 180);
        return () => {
            task.cancel();
            clearTimeout(fallback);
        };
    }, [deferExtraSlides, list.length, resetKey]);

    const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const next = Math.round(e.nativeEvent.contentOffset.x / width);
        setIndex(Math.max(0, Math.min(list.length - 1, next)));
        unlockTabPager();
    };

    if (list.length <= 1) {
        const uri = list[0] ?? fallback;
        const node = (
            <PlanImage
                source={resolvePlanImageSource(uri)}
                style={{ width, height }}
                recyclingKey={recyclingKey ?? 'cover'}
                priority={priority}
            />
        );
        if (!onPress) return <View style={{ width, height }}>{node}</View>;
        return (
            <Pressable onPress={onPress} style={{ width, height }}>
                {node}
            </Pressable>
        );
    }

    // ScrollView (no FlatList): anidar VirtualizedList dentro del FlashList del feed congela Yoga.
    return (
        <View style={{ height, width }}>
            <ScrollView
                ref={scrollRef}
                horizontal
                pagingEnabled
                nestedScrollEnabled
                directionalLockEnabled
                disableIntervalMomentum
                decelerationRate="fast"
                showsHorizontalScrollIndicator={false}
                bounces={false}
                overScrollMode="never"
                onScrollBeginDrag={() => {
                    if (!extrasReady) setExtrasReady(true);
                    lockTabPager();
                }}
                onMomentumScrollEnd={onMomentumEnd}
                keyboardShouldPersistTaps="handled"
                style={{ height, width }}
            >
                {list.map((uri, i) => {
                    const showImage = i === 0 || extrasReady;
                    const node = showImage ? (
                        <PlanImage
                            source={resolvePlanImageSource(uri)}
                            style={{ width, height }}
                            recyclingKey={`${recyclingKey ?? 'cover'}-${i}`}
                            priority={i === 0 ? priority : 'low'}
                        />
                    ) : (
                        <View style={{ width, height, backgroundColor: '#E2E8F0' }} />
                    );
                    return onPress ? (
                        <Pressable key={`${i}-${uri.slice(-24)}`} onPress={onPress} style={{ height, width }}>
                            {node}
                        </Pressable>
                    ) : (
                        <View key={`${i}-${uri.slice(-24)}`} style={{ height, width }}>
                            {node}
                        </View>
                    );
                })}
            </ScrollView>
            <View style={[styles.dots, { bottom: dotsBottom }]} pointerEvents="none">
                {list.map((_, i) => (
                    <View key={i} style={[styles.dot, i === safeIndex && styles.dotOn]} />
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    dots: {
        position: 'absolute',
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
        zIndex: 6,
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: 'rgba(255,255,255,0.55)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(15,42,74,0.35)',
    },
    dotOn: {
        backgroundColor: '#FFFFFF',
        transform: [{ scale: 1.15 }],
        borderColor: 'rgba(15,42,74,0.2)',
    },
});
