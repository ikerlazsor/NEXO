import { Platform } from 'react-native';

/** Props compartidos para FlatList legacy (pantallas que aún no usan FlashList). */
export const OPTIMIZED_LIST_PROPS = {
    initialNumToRender: 8,
    maxToRenderPerBatch: 6,
    windowSize: 9,
    updateCellsBatchingPeriod: 50,
    removeClippedSubviews: Platform.OS === 'android',
} as const;

export const COMPACT_LIST_PROPS = {
    initialNumToRender: 10,
    maxToRenderPerBatch: 8,
    windowSize: 7,
    updateCellsBatchingPeriod: 50,
    removeClippedSubviews: Platform.OS === 'android',
} as const;

/**
 * FlashList v2 (New Architecture) no necesita estimatedItemSize ni los props
 * de virtualización de FlatList. Mantener el contenedor con flex:1.
 */
export const FLASH_LIST_DRAW_DISTANCE = 420;
