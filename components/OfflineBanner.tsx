import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../lib/i18n';
import { subscribeNetwork } from '../lib/network';

/** Aviso fino cuando no hay red (no bloquea la app). */
export function OfflineBanner() {
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [offline, setOffline] = useState(false);

    useEffect(() => {
        return subscribeNetwork((online) => setOffline(!online));
    }, []);

    if (!offline) return null;

    return (
        <View style={[styles.wrap, { paddingTop: Math.max(insets.top, 8) }]} pointerEvents="none">
            <View style={styles.banner}>
                <Ionicons name="cloud-offline-outline" size={16} color="#FFF" />
                <Text style={styles.text}>{t('common.offline')}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#0F172A',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        opacity: 0.92,
    },
    text: {
        color: '#FFF',
        fontSize: 13,
        fontWeight: '700',
    },
});
