import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { NexoMapView } from './NexoMapView';
import { isNativeMapsAvailable } from '../lib/mapsConfig';
import {
    markMapEngineReady,
    subscribeMapWarmRegions,
    takeNextWarmRegion,
    type MapWarmRegion,
    warmMapRegion,
} from '../lib/mapWarm';

const BOOT_REGION: MapWarmRegion = {
    latitude: 40.4168,
    longitude: -3.7038,
    latitudeDelta: 0.28,
    longitudeDelta: 0.28,
};

/**
 * MapView 1×1 oculto: inicializa el SDK nativo y pide tiles de regiones
 * (feed / mis planes) para que al abrir mapa o detalle no espere en frío.
 */
export function NativeMapWarmHost() {
    const [region, setRegion] = useState(BOOT_REGION);
    const drainingRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!isNativeMapsAvailable()) {
            markMapEngineReady();
            return;
        }
        warmMapRegion(BOOT_REGION);

        const drain = () => {
            if (drainingRef.current) return;
            const next = takeNextWarmRegion();
            if (!next) {
                drainingRef.current = false;
                return;
            }
            drainingRef.current = true;
            setRegion(next);
            timerRef.current = setTimeout(() => {
                drainingRef.current = false;
                drain();
            }, Platform.OS === 'ios' ? 420 : 550);
        };

        const unsub = subscribeMapWarmRegions(() => {
            drain();
        });
        drain();

        return () => {
            unsub();
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    if (!isNativeMapsAvailable()) return null;

    return (
        <View style={styles.host} pointerEvents="none" collapsable={false}>
            <NexoMapView
                style={styles.map}
                pointerEvents="none"
                loadingEnabled={false}
                scrollEnabled={false}
                zoomEnabled={false}
                pitchEnabled={false}
                rotateEnabled={false}
                toolbarEnabled={false}
                moveOnMarkerPress={false}
                liteMode={Platform.OS === 'android'}
                region={{
                    latitude: region.latitude,
                    longitude: region.longitude,
                    latitudeDelta: region.latitudeDelta ?? 0.05,
                    longitudeDelta: region.longitudeDelta ?? 0.05,
                }}
                onMapReady={markMapEngineReady}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    host: {
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0.01,
        left: 0,
        top: 0,
        overflow: 'hidden',
        zIndex: -1,
    },
    map: {
        width: 1,
        height: 1,
    },
});
