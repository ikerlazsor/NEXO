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
 * MapView nativo en iOS/Android. El fallback gris solo queda para web
 * u otros; en Android ya no se apaga por un flag de OTA.
 */
const mapFallbackStyles = StyleSheet.create({
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

export const NexoMapView = forwardRef<MapView, Props>(function NexoMapView(
    { fallbackStyle, fallbackHint, style, children, ...props },
    ref,
) {
    if (!isNativeMapsAvailable()) {
        return (
            <View style={[mapFallbackStyles.fallback, style, fallbackStyle]}>
                <Ionicons name="map-outline" size={28} color="#94A3B8" />
                {fallbackHint ? (
                    <Text style={mapFallbackStyles.fallbackText}>{fallbackHint}</Text>
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
