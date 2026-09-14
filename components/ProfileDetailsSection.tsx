import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useT } from '../lib/i18n';
import {
    HABITO_BEBIDA_OPTIONS,
    HABITO_TABACO_OPTIONS,
    type Genero,
    type HabitoConsumo,
    type ProfilePrivacy,
} from '../lib/profileFields';

const INK = '#0F172A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const ACCENT = '#2563EB';

function generoIcon(g: Genero): keyof typeof Ionicons.glyphMap {
    switch (g) {
        case 'masculino': return 'male';
        case 'femenino': return 'female';
        case 'no_binario': return 'male-female';
        case 'otro': return 'ellipsis-horizontal';
        default: return 'help-circle-outline';
    }
}

function DetailRow({
    label,
    labelIcon,
    value,
    valueIcon,
    hidden,
    onEdit,
    onToggleVisible,
    hiddenLabel,
}: {
    label: string;
    labelIcon?: ReactNode;
    value: string;
    valueIcon?: ReactNode;
    hidden: boolean;
    onEdit?: () => void;
    onToggleVisible: (v: boolean) => void;
    hiddenLabel: string;
    showLabel: string;
}) {
    return (
        <View style={styles.row}>
            <View style={styles.labelRow}>
                {labelIcon}
                <Text style={styles.rowLabel}>{label}</Text>
            </View>
            <TouchableOpacity
                style={styles.valueHit}
                onPress={onEdit}
                disabled={!onEdit}
                activeOpacity={onEdit ? 0.7 : 1}
            >
                {!hidden && valueIcon}
                <Text style={[styles.rowValue, hidden && styles.rowValueHidden]} numberOfLines={1}>
                    {hidden ? hiddenLabel : value}
                </Text>
                {onEdit && !hidden ? (
                    <Ionicons name="pencil-outline" size={14} color={MUTED} style={styles.editIcon} />
                ) : null}
            </TouchableOpacity>
            <Switch
                value={!hidden}
                onValueChange={(v) => onToggleVisible(v)}
                trackColor={{ false: '#E2E8F0', true: '#BFDBFE' }}
                thumbColor={hidden ? '#94A3B8' : ACCENT}
                style={styles.switch}
            />
        </View>
    );
}

interface Props {
    age: number | null;
    genero: Genero | null;
    habitoBebida: HabitoConsumo;
    habitoTabaco: HabitoConsumo;
    privacy: ProfilePrivacy;
    onSaveHabitos: (bebida: HabitoConsumo, tabaco: HabitoConsumo) => void;
    onPrivacyChange: (privacy: ProfilePrivacy) => void;
}

export function ProfileDetailsSection({
    age,
    genero,
    habitoBebida,
    habitoTabaco,
    privacy,
    onSaveHabitos,
    onPrivacyChange,
}: Props) {
    const { t } = useT();
    const [editBebida, setEditBebida] = useState(false);
    const [editTabaco, setEditTabaco] = useState(false);

    const updatePrivacy = (key: keyof ProfilePrivacy, visible: boolean) => {
        onPrivacyChange({ ...privacy, [key]: visible });
    };

    const ageValue = age != null ? String(age) : t('profile.notSet');
    const generoValue = genero ? t('genero.' + genero) : t('profile.notSet');
    const bebidaValue =
        habitoBebida !== 'no_especificado' ? t('habito.' + habitoBebida) : t('profile.notSet');
    const tabacoValue =
        habitoTabaco !== 'no_especificado' ? t('habito.' + habitoTabaco) : t('profile.notSet');

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <View style={styles.headerIcon}>
                    <Ionicons name="person" size={16} color={ACCENT} />
                </View>
                <Text style={styles.headerTitle}>{t('profile.details')}</Text>
            </View>
            <DetailRow
                label={t('profile.age')}
                value={ageValue}
                hidden={!privacy.mostrar_edad}
                hiddenLabel={t('profile.hidden')}
                showLabel={t('profile.visible')}
                onToggleVisible={(v) => updatePrivacy('mostrar_edad', v)}
            />
            <DetailRow
                label={t('profile.gender')}
                value={generoValue}
                valueIcon={genero ? <Ionicons name={generoIcon(genero)} size={15} color={ACCENT} /> : null}
                hidden={!privacy.mostrar_genero}
                hiddenLabel={t('profile.hidden')}
                showLabel={t('profile.visible')}
                onToggleVisible={(v) => updatePrivacy('mostrar_genero', v)}
            />
            <DetailRow
                label={t('profile.alcohol')}
                labelIcon={<Ionicons name="wine-outline" size={14} color={MUTED} />}
                value={bebidaValue}
                hidden={!privacy.mostrar_bebida}
                hiddenLabel={t('profile.hidden')}
                showLabel={t('profile.visible')}
                onEdit={() => setEditBebida(true)}
                onToggleVisible={(v) => updatePrivacy('mostrar_bebida', v)}
            />
            <DetailRow
                label={t('profile.smoking')}
                labelIcon={<MaterialCommunityIcons name="smoking" size={14} color={MUTED} />}
                value={tabacoValue}
                hidden={!privacy.mostrar_tabaco}
                hiddenLabel={t('profile.hidden')}
                showLabel={t('profile.visible')}
                onEdit={() => setEditTabaco(true)}
                onToggleVisible={(v) => updatePrivacy('mostrar_tabaco', v)}
            />

            <Modal visible={editBebida} transparent animationType="slide" onRequestClose={() => setEditBebida(false)}>
                <Pressable style={styles.modalBg} onPress={() => setEditBebida(false)}>
                    <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
                        <Text style={styles.modalTitle}>{t('profile.alcohol')}</Text>
                        {HABITO_BEBIDA_OPTIONS.filter((h) => h !== 'no_especificado').map((h) => (
                            <TouchableOpacity
                                key={h}
                                style={styles.sheetOption}
                                onPress={() => {
                                    onSaveHabitos(h, habitoTabaco);
                                    setEditBebida(false);
                                }}
                            >
                                <Ionicons name="wine-outline" size={20} color={ACCENT} />
                                <Text style={styles.sheetOptionText}>{t('habito.' + h)}</Text>
                            </TouchableOpacity>
                        ))}
                    </Pressable>
                </Pressable>
            </Modal>

            <Modal visible={editTabaco} transparent animationType="slide" onRequestClose={() => setEditTabaco(false)}>
                <Pressable style={styles.modalBg} onPress={() => setEditTabaco(false)}>
                    <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
                        <Text style={styles.modalTitle}>{t('profile.smoking')}</Text>
                        {HABITO_TABACO_OPTIONS.filter((h) => h !== 'no_especificado').map((h) => (
                            <TouchableOpacity
                                key={h}
                                style={styles.sheetOption}
                                onPress={() => {
                                    onSaveHabitos(habitoBebida, h);
                                    setEditTabaco(false);
                                }}
                            >
                                <MaterialCommunityIcons name="smoking" size={20} color={ACCENT} />
                                <Text style={styles.sheetOptionText}>{t('habito.' + h)}</Text>
                            </TouchableOpacity>
                        ))}
                    </Pressable>
                </Pressable>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#F8FBFF',
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 10,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#DBEAFE',
        shadowColor: '#2563EB',
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    headerIcon: {
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: '#DBEAFE',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: { fontSize: 17, fontWeight: '800', color: INK, letterSpacing: -0.2 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 46,
        paddingVertical: 8,
        paddingHorizontal: 8,
        gap: 8,
        backgroundColor: '#FFF',
        borderRadius: 14,
        marginBottom: 8,
    },
    labelRow: {
        width: 88,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
    },
    rowLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: MUTED,
        flexShrink: 1,
    },
    valueHit: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
    },
    rowValue: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: INK },
    rowValueHidden: { color: MUTED, fontStyle: 'italic', fontWeight: '500' },
    editIcon: { marginLeft: 2 },
    switch: {
        transform: Platform.OS === 'ios' ? [{ scaleX: 0.78 }, { scaleY: 0.78 }] : [{ scaleX: 0.9 }, { scaleY: 0.9 }],
    },
    modalBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'center', padding: 24 },
    modalTitle: { fontSize: 17, fontWeight: '700', color: INK, marginBottom: 14 },
    sheet: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        maxHeight: '50%',
        marginTop: 'auto',
    },
    sheetOption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },
    sheetOptionText: { fontSize: 16, fontWeight: '600', color: INK },
});
