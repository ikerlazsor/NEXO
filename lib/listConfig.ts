import { Platform } from 'react-native';

/** Props compartidos para FlatList con muchos ítems e imágenes. */
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
