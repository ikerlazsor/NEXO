import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, NativeModules, Platform, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { eventWhenLabel } from '../features/events/EventCards';
import { fetchEvent } from '../features/events/api';
import { eventCoverSource } from '../features/events/covers';
import { resolvePlanImageSource } from '../lib/categories';
import { useT } from '../lib/i18n';
import { formatProfilePlanWhen } from '../lib/profileSocial';
import { setShareStoryListener, shareLinkWithSystem, type ShareTarget } from '../lib/shareChooser';
import { withShareTouchGuard } from '../lib/shareTouchGuard';
import { supabase } from '../lib/supabase';

/**
 * Compartir en Instagram: Instagram no pinta tarjetas de enlace en historias,
 * así que se genera una imagen 9:16 con la misma tarjeta que se ve en WhatsApp
 * (portada, título, cuándo · dónde y appnexo.es) y se abre Instagram con ella.
 */

/** Lienzo en puntos; se captura a 1080×1920. */
const W = 360;
const H = 640;
const CARD_W = 300;
const COVER_H = 200;
/** Si la portada no avisa de que ha cargado, se captura igual pasado este rato. */
const COVER_WAIT_MS = 3000;

type Card = {
    title: string;
    when: string;
    place: string;
    cover: number | string | null;
    url: string;
};

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasNativeRnShare(): boolean {
    try {
        return !!(NativeModules as Record<string, unknown>).RNShare;
    } catch {
        return false;
    }
}

async function loadCard(target: ShareTarget, lang: string): Promise<Card> {
    if (target.kind === 'event') {
        const event = await fetchEvent(target.id);
        return {
            title: event.title,
            when: eventWhenLabel(event, lang),
            place: (event.venue || '').trim(),
            cover: eventCoverSource(event),
            url: target.url,
        };
    }
    const { data } = await supabase
        .from('planes')
        .select('titulo, imagen_url, nombre_ubicacion, fecha_evento')
        .eq('id', target.id)
        .maybeSingle();
    return {
        title: (data?.titulo as string | null)?.trim() || target.title,
        when: formatProfilePlanWhen(data?.fecha_evento as string | null, lang),
        place: ((data?.nombre_ubicacion as string | null) || '').trim(),
        cover: data?.imagen_url ? resolvePlanImageSource(data.imagen_url as string) : null,
        url: target.url,
    };
}

/** Abre Instagram con la imagen (Android directo; iOS por la hoja del sistema). */
async function openInstagramWithImage(fileUri: string): Promise<boolean> {
    const uri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;
    if (Platform.OS === 'android' && hasNativeRnShare()) {
        try {
            const { default: RNShare, Social } = await import('react-native-share');
            await RNShare.shareSingle({
                social: Social.Instagram,
                url: uri,
                type: 'image/jpeg',
            });
            return true;
        } catch {
            /* Instagram no instalado: hoja del sistema */
        }
    }
    try {
        if (Platform.OS === 'ios') {
            // Solo la imagen: combinar imagen + texto ha llegado a tumbar la app en iOS.
            await withShareTouchGuard(() => Share.share({ url: uri }));
            return true;
        }
        if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Instagram', UTI: 'public.jpeg' });
            return true;
        }
    } catch {
        /* cancelado */
        return true;
    }
    return false;
}

export function ShareStoryHost() {
    const { lang } = useT();
    const [card, setCard] = useState<Card | null>(null);
    const [coverReady, setCoverReady] = useState(false);
    const cardRef = useRef<View>(null);
    const busyRef = useRef(false);
    const langRef = useRef(lang);
    langRef.current = lang;

    useEffect(() => {
        setShareStoryListener((target) => {
            if (busyRef.current) return;
            busyRef.current = true;
            setCoverReady(false);
            void loadCard(target, langRef.current)
                .then((next) => {
                    setCard(next);
                    if (!next.cover) setCoverReady(true);
                })
                .catch(() => {
                    busyRef.current = false;
                    void shareLinkWithSystem(target.url, target.title);
                });
        });
        return () => setShareStoryListener(null);
    }, []);

    // Portada lenta o en caché sin onLoad: no bloquear.
    useEffect(() => {
        if (!card || coverReady) return;
        const timer = setTimeout(() => setCoverReady(true), COVER_WAIT_MS);
        return () => clearTimeout(timer);
    }, [card, coverReady]);

    const capture = useCallback(async (current: Card) => {
        let uri: string | null = null;
        try {
            // Un frame para que la imagen pintada entre en la captura.
            await sleep(60);
            if (cardRef.current) {
                uri = await captureRef(cardRef, {
                    format: 'jpg',
                    quality: 0.92,
                    result: 'tmpfile',
                    width: 1080,
                    height: 1920,
                });
            }
        } catch {
            uri = null;
        }
        // iOS: cerrar el Modal ANTES de abrir la hoja del sistema.
        setCard(null);
        await sleep(48);
        busyRef.current = false;
        const opened = uri ? await openInstagramWithImage(uri) : false;
        if (!opened) await shareLinkWithSystem(current.url, current.title);
    }, []);

    useEffect(() => {
        if (card && coverReady) void capture(card);
    }, [card, coverReady, capture]);

    if (!card) return null;
    const cover = card.cover;
    const onCover = () => setCoverReady(true);

    return (
        <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => setCard(null)}>
            {/* Invisible pero en pantalla: view-shot en iOS no captura fuera de ella. */}
            <View style={styles.host} pointerEvents="none">
                <View ref={cardRef} collapsable={false} style={styles.canvas}>
                    <LinearGradient
                        colors={['#0F2A4A', '#1E4FA8', '#4DA6FF']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.card}>
                        {typeof cover === 'number' ? (
                            <Image source={cover} style={styles.cover} resizeMode="cover" onLoad={onCover} onError={onCover} />
                        ) : cover ? (
                            <Image source={{ uri: cover }} style={styles.cover} resizeMode="cover" onLoad={onCover} onError={onCover} />
                        ) : (
                            <View style={[styles.cover, styles.coverFallback]} />
                        )}
                        <View style={styles.body}>
                            <Text style={styles.title} numberOfLines={3}>
                                {card.title}
                            </Text>
                            {card.when ? (
                                <View style={styles.metaRow}>
                                    <Ionicons name="calendar-outline" size={16} color="#2563EB" />
                                    <Text style={styles.metaText} numberOfLines={1}>
                                        {card.when}
                                    </Text>
                                </View>
                            ) : null}
                            {card.place ? (
                                <View style={styles.metaRow}>
                                    <Ionicons name="location-outline" size={16} color="#2563EB" />
                                    <Text style={styles.metaText} numberOfLines={2}>
                                        {card.place}
                                    </Text>
                                </View>
                            ) : null}
                            <View style={styles.footer}>
                                <Text style={styles.site}>appnexo.es</Text>
                            </View>
                        </View>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    host: { ...StyleSheet.absoluteFillObject, opacity: 0, alignItems: 'center', justifyContent: 'center' },
    canvas: { width: W, height: H, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    card: {
        width: CARD_W,
        borderRadius: 26,
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
    },
    cover: { width: CARD_W, height: COVER_H, backgroundColor: '#CBD5E1' },
    coverFallback: { backgroundColor: '#2563EB' },
    body: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14, gap: 8 },
    title: { fontSize: 22, lineHeight: 27, fontWeight: '800', color: '#0F172A', marginBottom: 2 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    metaText: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: '#334155' },
    footer: {
        marginTop: 6,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#E2E8F0',
    },
    site: { fontSize: 13, fontWeight: '700', color: '#64748B', letterSpacing: 0.2 },
});
