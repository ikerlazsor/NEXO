import { forwardRef, useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import {
    formatDisplayLabel,
    isFutsalConfig,
    slotPositions,
    uiFormatFromConfig,
    type FootballConfig,
    type FootballOccupant,
} from '../lib/footballLineup';

export type FootballSharePerson = {
    id: string;
    nombre: string;
    avatar_url?: string | null;
};

export type FootballShareCardProps = {
    title: string;
    when?: string | null;
    location?: string | null;
    spotsLeft: number;
    maxPeople: number;
    joinedCount: number;
    config: FootballConfig | null;
    slots: FootballOccupant[];
    people: FootballSharePerson[];
    lang?: string;
};

/** Ancho lógico compacto para WhatsApp (la captura escala a retina). */
export const FOOTBALL_SHARE_WIDTH = 360;
const PITCH_W = FOOTBALL_SHARE_WIDTH - 24;
const PITCH_H = 168;
const SLOT = 26;

function ShareAvatar({
    uri,
    name,
    size,
}: {
    uri?: string | null;
    name: string;
    size: number;
}) {
    const source = uri?.trim()
        ? { uri }
        : {
              uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=E2E8F0&color=475569&size=${Math.round(size * 2)}`,
          };
    return (
        <Image
            source={source}
            style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#CBD5E1' }}
        />
    );
}

/**
 * Cartel corto estilo pachanga: aviso de plazas + mini alineación con fotos.
 * Pensado para capturar y mandar por WhatsApp sin ocupar media pantalla.
 */
export const FootballShareCard = forwardRef<View, FootballShareCardProps>(function FootballShareCard(
    {
        title,
        when,
        location,
        spotsLeft,
        maxPeople,
        joinedCount,
        config,
        slots,
        people,
        lang = 'es',
    },
    ref,
) {
    const isEn = lang.startsWith('en');
    const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

    const spots = Math.max(0, Math.floor(spotsLeft));
    const urgency =
        spots <= 0
            ? isEn
                ? 'FULL SQUAD'
                : '¡COMPLETO!'
            : spots === 1
              ? isEn
                  ? '1 SPOT LEFT'
                  : 'QUEDA 1 PLAZA'
              : isEn
                ? `${spots} SPOTS LEFT`
                : `QUEDAN ${spots} PLAZAS`;

    const format =
        config != null
            ? formatDisplayLabel(uiFormatFromConfig(config))
            : null;
    const metaBits = [format, when?.trim() || null, location?.trim() || null].filter(Boolean) as string[];
    const futsal = config ? isFutsalConfig(config) : false;

    return (
        <View ref={ref} collapsable={false} style={styles.card}>
            <View style={[styles.urgency, spots <= 0 && styles.urgencyFull]}>
                <Text style={[styles.urgencyText, spots <= 0 && styles.urgencyTextFull]}>{urgency}</Text>
            </View>

            <View style={styles.body}>
                <View style={styles.stampRow}>
                    <Text style={styles.stamp}>PACHANGA</Text>
                    {format ? <Text style={styles.formatPill}>{format}</Text> : null}
                </View>

                <Text style={styles.title} numberOfLines={1}>
                    {title.trim() || (isEn ? 'Kickabout' : 'Partido')}
                </Text>
                {metaBits.length ? (
                    <Text style={styles.meta} numberOfLines={1}>
                        {metaBits.join(' · ')}
                    </Text>
                ) : null}

                {config ? (
                    <View style={[styles.pitch, futsal && styles.pitchFutsal]}>
                        <View style={[styles.midLine, { top: PITCH_H / 2 - 0.75 }]} />
                        <View
                            style={[
                                styles.centerCircle,
                                {
                                    left: PITCH_W / 2 - 18,
                                    top: PITCH_H / 2 - 18,
                                },
                            ]}
                        />
                        <View style={[styles.box, styles.boxTop, { left: PITCH_W * 0.28, width: PITCH_W * 0.44 }]} />
                        <View style={[styles.box, styles.boxBottom, { left: PITCH_W * 0.28, width: PITCH_W * 0.44 }]} />
                        {([0, 1] as const).map((equipo) =>
                            slotPositions(config, equipo).map((slot, posicion) => {
                                const taken = slots.find(
                                    (s) => s.equipo === equipo && s.posicion === posicion,
                                );
                                const person = taken ? peopleById.get(taken.usuario_id) : null;
                                const teamColor = config.equipos[equipo]?.color ?? '#FFF';
                                return (
                                    <View
                                        key={`${equipo}-${posicion}`}
                                        style={[
                                            styles.slot,
                                            {
                                                left: slot.x * PITCH_W - SLOT / 2,
                                                top: slot.y * PITCH_H - SLOT / 2,
                                                borderColor: teamColor,
                                            },
                                            !taken && styles.slotEmpty,
                                        ]}
                                    >
                                        {taken ? (
                                            <ShareAvatar
                                                uri={person?.avatar_url}
                                                name={person?.nombre ?? '?'}
                                                size={SLOT - 3}
                                            />
                                        ) : (
                                            <View style={styles.emptyDot} />
                                        )}
                                    </View>
                                );
                            }),
                        )}
                    </View>
                ) : (
                    <View style={styles.facesRow}>
                        {people.slice(0, 8).map((p, i) => (
                            <View key={p.id} style={[styles.face, { marginLeft: i === 0 ? 0 : -8, zIndex: 8 - i }]}>
                                <ShareAvatar uri={p.avatar_url} name={p.nombre} size={34} />
                            </View>
                        ))}
                        {joinedCount < maxPeople ? (
                            <View style={[styles.face, styles.faceMore, { marginLeft: people.length ? -6 : 0 }]}>
                                <Text style={styles.faceMoreText}>+{Math.max(0, maxPeople - joinedCount)}</Text>
                            </View>
                        ) : null}
                    </View>
                )}

                <View style={styles.footer}>
                    <Text style={styles.footerHint}>
                        {isEn ? 'Tap the link · Nexo!' : 'Entra al link · Nexo!'}
                    </Text>
                    <Text style={styles.count}>
                        {joinedCount}/{maxPeople}
                    </Text>
                </View>
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    card: {
        width: FOOTBALL_SHARE_WIDTH,
        backgroundColor: '#0B3D2E',
        borderRadius: 18,
        overflow: 'hidden',
        borderWidth: 3,
        borderColor: '#FACC15',
    },
    urgency: {
        backgroundColor: '#FACC15',
        paddingVertical: 8,
        paddingHorizontal: 12,
        alignItems: 'center',
    },
    urgencyFull: {
        backgroundColor: '#EF4444',
    },
    urgencyText: {
        fontSize: 18,
        fontWeight: '900',
        letterSpacing: 1.2,
        color: '#111827',
        textTransform: 'uppercase',
    },
    urgencyTextFull: {
        color: '#FFF',
    },
    body: {
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 10,
    },
    stampRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    stamp: {
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 2.4,
        color: '#FDE68A',
    },
    formatPill: {
        fontSize: 11,
        fontWeight: '800',
        color: '#0B3D2E',
        backgroundColor: '#A7F3D0',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        overflow: 'hidden',
    },
    title: {
        fontSize: 17,
        fontWeight: '900',
        color: '#F8FAFC',
        marginBottom: 2,
    },
    meta: {
        fontSize: 12,
        fontWeight: '700',
        color: '#BBF7D0',
        marginBottom: 8,
    },
    pitch: {
        width: PITCH_W,
        height: PITCH_H,
        borderRadius: 12,
        backgroundColor: '#15803D',
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.55)',
        overflow: 'hidden',
        marginBottom: 8,
        alignSelf: 'center',
    },
    pitchFutsal: {
        backgroundColor: '#C2410C',
        borderColor: 'rgba(255,255,255,0.7)',
    },
    midLine: {
        position: 'absolute',
        left: 8,
        right: 8,
        height: 1.5,
        backgroundColor: 'rgba(255,255,255,0.7)',
    },
    centerCircle: {
        position: 'absolute',
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.65)',
    },
    box: {
        position: 'absolute',
        height: 28,
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.55)',
    },
    boxTop: { top: 0, borderTopWidth: 0 },
    boxBottom: { bottom: 0, borderBottomWidth: 0 },
    slot: {
        position: 'absolute',
        width: SLOT,
        height: SLOT,
        borderRadius: SLOT / 2,
        borderWidth: 2,
        overflow: 'hidden',
        backgroundColor: 'rgba(15,23,42,0.25)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    slotEmpty: {
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderStyle: 'solid',
        borderColor: 'rgba(255,255,255,0.55)',
    },
    emptyDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: 'rgba(255,255,255,0.75)',
    },
    facesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 44,
        marginBottom: 8,
        paddingVertical: 4,
    },
    face: {
        borderRadius: 20,
        borderWidth: 2,
        borderColor: '#FACC15',
        overflow: 'hidden',
    },
    faceMore: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#14532D',
        alignItems: 'center',
        justifyContent: 'center',
    },
    faceMoreText: {
        fontSize: 11,
        fontWeight: '900',
        color: '#FDE68A',
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    footerHint: {
        fontSize: 11,
        fontWeight: '800',
        color: '#86EFAC',
        letterSpacing: 0.3,
    },
    count: {
        fontSize: 12,
        fontWeight: '900',
        color: '#F8FAFC',
    },
});
