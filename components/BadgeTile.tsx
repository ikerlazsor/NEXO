import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BadgeDefinition } from '../lib/badges';

const LOCKED_BG = '#E2E8F0';

interface Props {
    badge: BadgeDefinition & { unlocked: boolean };
    size?: 'grid' | 'modal';
    onPress?: () => void;
}

export function BadgeTile({ badge, size = 'grid', onPress }: Props) {
    const dim = size === 'modal' ? 88 : 64;
    const iconSize = size === 'modal' ? 36 : 26;

    const inner = (
        <View style={[styles.wrap, { width: dim, height: dim }]}>
            {badge.unlocked ? (
                <LinearGradient
                    colors={badge.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.tile, styles.tileUnlocked, { width: dim, height: dim, borderRadius: dim * 0.28 }]}
                >
                    <View style={styles.shine} />
                    <Ionicons name={badge.icon as keyof typeof Ionicons.glyphMap} size={iconSize} color="#FFF" />
                    {badge.tier !== 'special' && (
                        <View style={[styles.tierDot, { backgroundColor: badge.accent }]}>
                            <Text style={styles.tierText}>{badge.tier}</Text>
                        </View>
                    )}
                </LinearGradient>
            ) : (
                <View style={[styles.tile, styles.tileLocked, { width: dim, height: dim, borderRadius: dim * 0.28 }]}>
                    <Ionicons name={badge.icon as keyof typeof Ionicons.glyphMap} size={iconSize} color="#94A3B8" />
                </View>
            )}
            {badge.unlocked && (
                <View style={[styles.ring, { width: dim + 6, height: dim + 6, borderRadius: (dim + 6) * 0.28, borderColor: badge.accent + '55' }]} />
            )}
        </View>
    );

    if (onPress) {
        return (
            <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.pressable}>
                {inner}
            </TouchableOpacity>
        );
    }
    return inner;
}

const styles = StyleSheet.create({
    pressable: { alignItems: 'center' },
    wrap: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
    ring: {
        position: 'absolute',
        borderWidth: 2,
        top: -3,
        left: -3,
    },
    tile: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    tileUnlocked: {
        shadowColor: '#000',
        shadowOpacity: 0.22,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
    },
    tileLocked: {
        backgroundColor: '#F1F5F9',
        borderWidth: 2,
        borderColor: LOCKED_BG,
    },
    shine: {
        position: 'absolute',
        top: -10,
        right: -10,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.25)',
    },
    tierDot: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        width: 16,
        height: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: '#FFF',
    },
    tierText: { color: '#FFF', fontSize: 9, fontWeight: '900' },
});
