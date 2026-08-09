import { Ionicons } from '@expo/vector-icons';
import { forwardRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { type MapViewProps } from 'react-native-maps';
import { isNativeMapsAvailable, nexoMapProvider } from '../lib/mapsConfig';

type Props = MapViewProps & {
    fallbackStyle?: StyleProp<ViewStyle>;
    fallbackHint?: string;
};

/**
 * MapView seguro: sin API key de Google en builds Android standalone,
 * no montamos el nativo (evita el crash al abrir crear plan / detalle).
 */
export const NexoMapView = forwardRef<MapView, Props>(function NexoMapView(
    { fallbackStyle, fallbackHint, style, children, ...props },
    ref,
) {
    if (!isNativeMapsAvailable()) {
        return (
            <View style={[styles.fallback, style, fallbackStyle]}>
                <Ionicons name="map-outline" size={28} color="#94A3B8" />
                {fallbackHint ? (
                    <Text style={styles.fallbackText}>{fallbackHint}</Text>
                ) : null}
            </View>
        );
    }

    return (
        <MapView ref={ref} provider={nexoMapProvider()} style={style} {...props}>
            {children}
        </MapView>
    );
});

const styles = StyleSheet.create({
    fallback: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#E8EEF5',
        gap: 8,
        padding: 16,
    },
    fallbackText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#64748B',
        textAlign: 'center',
    },
});
