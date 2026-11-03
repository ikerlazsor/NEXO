import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { resolveChatFileUrl } from '../lib/chatUpload';
import { useT } from '../lib/i18n';
import type { MomentItem } from '../lib/planMoments';

type Props = {
    items: MomentItem[];
    onOpen: (items: MomentItem[]) => void;
};

export function PlanMomentsMessage({ items, onOpen }: Props) {
    const { t } = useT();
    const [resolved, setResolved] = useState<MomentItem[]>(items);
    const cover = resolved.find((item) => item.type === 'image') ?? resolved[0];
    const signature = items.map((item) => `${item.type}:${item.url}`).join('|');

    useEffect(() => {
        let alive = true;
        void Promise.all(
            items.map(async (item) => ({
                ...item,
                url: (await resolveChatFileUrl(item.url)) || item.url,
            })),
        ).then((next) => {
            if (alive) setResolved(next);
        });
        return () => {
            alive = false;
        };
    }, [signature]);

    return (
        <Pressable onPress={() => onOpen(resolved)} style={styles.card}>
            {cover?.type === 'image' ? (
                <Image
                    source={{ uri: cover.url }}
                    style={styles.cover}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={cover.url}
                    transition={0}
                />
            ) : (
                <View style={styles.videoCover}>
                    <Ionicons name="play" size={36} color="#0F2A4A" />
                </View>
            )}
            <View style={styles.scrim} pointerEvents="none" />
            <View style={styles.footer} pointerEvents="none">
                <Text style={styles.title} numberOfLines={1}>{t('chat.moments')}</Text>
                <View style={styles.countPill}>
                    <Text style={styles.countText}>{items.length}</Text>
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        width: 268,
        height: 232,
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: '#0F172A',
    },
    cover: { width: '100%', height: '100%' },
    videoCover: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F8D48A',
    },
    scrim: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 78,
        backgroundColor: 'rgba(7,17,31,0.55)',
    },
    footer: {
        position: 'absolute',
        left: 14,
        right: 14,
        bottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    title: { flex: 1, color: '#F8FAFC', fontSize: 16, fontWeight: '800' },
    countPill: {
        minWidth: 28,
        height: 28,
        borderRadius: 14,
        paddingHorizontal: 8,
        backgroundColor: '#F8D48A',
        alignItems: 'center',
        justifyContent: 'center',
    },
    countText: { color: '#0F2A4A', fontSize: 14, fontWeight: '900' },
});
