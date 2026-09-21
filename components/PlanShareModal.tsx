import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Image,
    Modal,
    NativeModules,
    Platform,
    Share,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { resolvePlanImageSource } from '../lib/categories';
import { planShareUrl } from '../lib/shareLinks';
import { sharePlanLink } from '../lib/sharePlan';

export const PLAN_SHARE_WIDTH = 360;
const COVER_H = 222;
const MAX_AVATARS = 5;

export type PlanSharePerson = {
    id?: string;
    nombre?: string | null;
    avatar_url?: string | null;
};

export type PlanSharePayload = {
    planId: string;
    title: string;
    coverUrl?: string | null;
    when?: string | null;
    location?: string | null;
    people?: PlanSharePerson[];
    maxPeople?: number;
};

type Props = {
    payload: PlanSharePayload | null;
    onDone: () => void;
};

type CoverSource = { kind: 'asset'; source: number } | { kind: 'uri'; uri: string };

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function downloadToCache(url: string, prefix: string): Promise<string | null> {
    const src = (url || '').trim();
    if (!src) return null;
    if (src.startsWith('file://') || (src.startsWith('/') && !src.startsWith('//'))) return src;
    if (!/^https?:\/\//i.test(src)) return null;
    const dir = FileSystem.cacheDirectory;
    if (!dir) return null;
    try {
        const dest = `${dir}${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
        const res = await FileSystem.downloadAsync(src, dest);
        return res.status === 200 ? res.uri : null;
    } catch {
        return null;
    }
}

function resolveCoverSource(coverUrl?: string | null): CoverSource | null {
    const raw = (coverUrl || '').trim();
    if (!raw) return null;
    const resolved = resolvePlanImageSource(raw);
    if (typeof resolved === 'number') return { kind: 'asset', source: resolved };
    if (typeof resolved === 'string' && resolved.trim()) {
        const uri = resolved.trim();
        if (/^https?:\/\//i.test(uri) || uri.startsWith('file://')) return { kind: 'uri', uri };
    }
    try {
        const asset = Image.resolveAssetSource(
            typeof resolved === 'number' ? resolved : { uri: String(resolved) },
        );
        if (asset?.uri) return { kind: 'uri', uri: asset.uri };
    } catch {
        /* ignore */
    }
    return null;
}

function hasNativeRnShare(): boolean {
    try {
        return !!(NativeModules as Record<string, unknown>).RNShare;
    } catch {
        return false;
    }
}

/** Una hoja de sistema. Nunca importar react-native-share si no está en el binario (crash iOS). */
async function shareImageAndLink(imageUri: string, link: string) {
    const fileUri = imageUri.startsWith('file://') ? imageUri : `file://${imageUri}`;

    if (hasNativeRnShare()) {
        try {
            const RNShare = (await import('react-native-share')).default;
            await RNShare.open({
                url: fileUri,
                message: link,
                type: 'image/jpeg',
                failOnCancel: false,
            });
            return;
        } catch {
            /* fallback abajo */
        }
    }

    if (Platform.OS === 'ios') {
        await Share.share({ url: fileUri, message: link });
        return;
    }

    try {
        if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(fileUri, {
                mimeType: 'image/jpeg',
                dialogTitle: 'Compartir',
                UTI: 'public.jpeg',
            });
        }
    } catch {
        /* ignore */
    }
    await Share.share({ message: link, title: 'Nexo!' });
}

/**
 * Captura casi invisible (Modal transparente) → hoja de compartir.
 * Evita off-screen (-10000) y react-native-share sin nativo: ambos crashean iOS.
 */
export function PlanShareModal({ payload, onDone }: Props) {
    const cardRef = useRef<View>(null);
    const [coverSource, setCoverSource] = useState<CoverSource | null>(null);
    const [localAvatars, setLocalAvatars] = useState<string[]>([]);
    const [ready, setReady] = useState(false);
    const ranRef = useRef(false);

    const people = useMemo(() => (payload?.people ?? []).slice(0, 12), [payload?.people]);
    const visiblePeople = useMemo(() => people.slice(0, MAX_AVATARS), [people]);
    const extra = Math.max(0, people.length - MAX_AVATARS);
    const joined = people.length;
    const maxPeople = payload?.maxPeople ?? 0;

    useEffect(() => {
        if (!payload) {
            setCoverSource(null);
            setLocalAvatars([]);
            setReady(false);
            ranRef.current = false;
            return;
        }
        let cancelled = false;
        setReady(false);
        ranRef.current = false;

        void (async () => {
            const resolved = resolveCoverSource(payload.coverUrl);
            if (cancelled) return;

            if (!resolved) {
                setCoverSource(null);
            } else if (resolved.kind === 'asset') {
                setCoverSource(resolved);
            } else {
                // Timeout corto: no bloquear el share por la red
                const local = await Promise.race([
                    downloadToCache(resolved.uri, 'cover'),
                    sleep(1200).then(() => null),
                ]);
                if (cancelled) return;
                setCoverSource(local ? { kind: 'uri', uri: local } : resolved);
            }

            // Avatares en paralelo, máx ~1.2s; si fallan, iniciales remotas o vacío
            const avJobs = visiblePeople.map(async (p) => {
                const remote = (p.avatar_url || '').trim();
                if (!remote) return null;
                return (
                    (await Promise.race([
                        downloadToCache(remote, 'av'),
                        sleep(900).then(() => null),
                    ])) || remote
                );
            });
            const avs = (await Promise.all(avJobs)).filter((u): u is string => !!u);
            if (cancelled) return;
            setLocalAvatars(avs);
            setReady(true);
        })();

        return () => {
            cancelled = true;
        };
    }, [payload, visiblePeople]);

    const runShare = useCallback(async () => {
        if (!payload || ranRef.current) return;
        ranRef.current = true;
        const link = planShareUrl(payload.planId);
        try {
            // Pintar un frame en el Modal transparente
            await sleep(220);
            if (!cardRef.current) {
                await sharePlanLink(payload.planId, payload.title);
                return;
            }
            const uri = await captureRef(cardRef, {
                format: 'jpg',
                quality: 0.92,
                result: 'tmpfile',
            });
            await shareImageAndLink(uri, link);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!/User did not share|canceled|cancelled|dismiss/i.test(msg)) {
                try {
                    await sharePlanLink(payload.planId, payload.title);
                } catch {
                    /* ignore */
                }
            }
        } finally {
            onDone();
        }
    }, [payload, onDone]);

    useEffect(() => {
        if (!payload || !ready) return;
        void runShare();
    }, [payload, ready, runShare]);

    // Failsafe: si assets tardan, compartir solo el link (no expulsar ni colgar)
    useEffect(() => {
        if (!payload || ready || ranRef.current) return;
        const t = setTimeout(() => {
            if (ranRef.current) return;
            ranRef.current = true;
            void sharePlanLink(payload.planId, payload.title)
                .catch(() => undefined)
                .finally(() => onDone());
        }, 3500);
        return () => clearTimeout(t);
    }, [payload, ready, onDone]);

    if (!payload) return null;

    const title = payload.title.trim() || 'Plan';
    const when = (payload.when || '').trim();
    const location = (payload.location || '').trim();

    return (
        <Modal
            visible
            transparent
            animationType="none"
            statusBarTranslucent
            onRequestClose={onDone}
        >
            {/* Casi invisible pero EN pantalla — view-shot en iOS no tolera off-screen */}
            <View style={styles.captureHost} pointerEvents="none">
                <View ref={cardRef} collapsable={false} style={styles.card}>
                    <View style={styles.imageWrap} collapsable={false}>
                        {coverSource?.kind === 'asset' ? (
                            <Image source={coverSource.source} style={styles.cover} resizeMode="cover" />
                        ) : coverSource?.kind === 'uri' ? (
                            <Image source={{ uri: coverSource.uri }} style={styles.cover} resizeMode="cover" />
                        ) : (
                            <View style={[styles.cover, styles.coverFallback]} />
                        )}
                        <LinearGradient
                            colors={['rgba(15,42,74,0)', 'rgba(15,42,74,0)', 'rgba(15,42,74,0.62)']}
                            locations={[0, 0.4, 1]}
                            style={StyleSheet.absoluteFill}
                        />
                        <View style={styles.titleWrap}>
                            <Text style={styles.title} numberOfLines={2}>
                                {title}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.body}>
                        <View style={styles.avatarRow}>
                            <View style={styles.avatarStack}>
                                {localAvatars.map((uri, i) => (
                                    <View
                                        key={`${i}-${uri.slice(-12)}`}
                                        style={[
                                            styles.avatarWrap,
                                            { marginLeft: i === 0 ? 0 : -14, zIndex: localAvatars.length - i },
                                        ]}
                                    >
                                        <Image source={{ uri }} style={styles.avatar} />
                                    </View>
                                ))}
                                {extra > 0 ? (
                                    <View
                                        style={[
                                            styles.avatarWrap,
                                            styles.extra,
                                            { marginLeft: localAvatars.length ? -14 : 0 },
                                        ]}
                                    >
                                        <Text style={styles.extraText}>+{extra}</Text>
                                    </View>
                                ) : null}
                            </View>
                            <Text style={styles.peopleText}>
                                {joined}
                                {maxPeople > 0 ? ` / ${maxPeople}` : ''}
                            </Text>
                        </View>

                        <View style={styles.metaRow}>
                            {when ? (
                                <View style={styles.metaItem}>
                                    <Ionicons name="calendar-outline" size={15} color="#2563EB" />
                                    <Text style={styles.metaText} numberOfLines={1}>
                                        {when}
                                    </Text>
                                </View>
                            ) : null}
                            {location ? (
                                <View style={[styles.metaItem, { flex: 1 }]}>
                                    <Ionicons name="location-outline" size={15} color="#2563EB" />
                                    <Text style={styles.metaText} numberOfLines={1}>
                                        {location}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

export function buildPlanSharePayload(input: {
    planId: string;
    title: string;
    coverUrl?: string | null;
    when?: string | null;
    location?: string | null;
    participants?: PlanSharePerson[];
    maxPeople?: number;
}): PlanSharePayload {
    return {
        planId: input.planId,
        title: input.title,
        coverUrl: input.coverUrl,
        when: input.when,
        location: input.location,
        people: input.participants ?? [],
        maxPeople: input.maxPeople,
    };
}

const styles = StyleSheet.create({
    captureHost: {
        ...StyleSheet.absoluteFillObject,
        opacity: 0.02,
        justifyContent: 'center',
        alignItems: 'center',
    },
    card: {
        width: PLAN_SHARE_WIDTH,
        borderRadius: 24,
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
        borderWidth: 2,
        borderColor: 'rgba(37,99,235,0.22)',
    },
    imageWrap: {
        width: PLAN_SHARE_WIDTH - 4,
        height: COVER_H,
        backgroundColor: '#CBD5E1',
        overflow: 'hidden',
    },
    cover: { width: '100%', height: '100%' },
    coverFallback: { backgroundColor: '#2563EB' },
    titleWrap: { position: 'absolute', left: 14, right: 14, bottom: 14 },
    title: {
        color: '#FFF',
        fontSize: 24,
        fontWeight: '900',
        textShadowColor: 'rgba(0,0,0,0.55)',
        textShadowRadius: 8,
        textShadowOffset: { width: 0, height: 1 },
    },
    body: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, backgroundColor: '#FFF' },
    avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    avatarStack: { flexDirection: 'row', alignItems: 'center' },
    avatarWrap: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 2,
        borderColor: '#FFF',
        overflow: 'hidden',
        backgroundColor: '#E2E8F0',
    },
    avatar: { width: '100%', height: '100%' },
    extra: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2563EB' },
    extraText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
    peopleText: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '55%' },
    metaText: { fontSize: 13, fontWeight: '700', color: '#0F172A', flexShrink: 1 },
});
