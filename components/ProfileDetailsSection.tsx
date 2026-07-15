import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useT } from '../lib/i18n';
import {
    GENERO_OPTIONS,
    HABITO_BEBIDA_OPTIONS,
    HABITO_TABACO_OPTIONS,
    isValidAge,
    type Genero,
    type HabitoConsumo,
    type ProfilePrivacy,
} from '../lib/profileFields';

const INK = '#0F172A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const ACCENT = '#2563EB';

interface Props {
    age: number | null;
    genero: Genero | null;
    habitoBebida: HabitoConsumo;
    habitoTabaco: HabitoConsumo;
    privacy: ProfilePrivacy;
    onSaveAge: (age: number) => void;
    onSaveGenero: (g: Genero) => void;
    onSaveHabitos: (bebida: HabitoConsumo, tabaco: HabitoConsumo) => void;
    onPrivacyChange: (privacy: ProfilePrivacy) => void;
}

function DetailRow({
    label,
    value,
    hidden,
    onEdit,
    onToggleVisible,
    hiddenLabel,
    showLabel,
}: {
    label: string;
    value: string;
    hidden: boolean;
    onEdit?: () => void;
    onToggleVisible: (v: boolean) => void;
    hiddenLabel: string;
    showLabel: string;
}) {
    return (
        <View style={styles.row}>
            <View style={styles.rowMain}>
                <Text style={styles.rowLabel}>{label}</Text>
                <TouchableOpacity onPress={onEdit} disabled={!onEdit} activeOpacity={onEdit ? 0.7 : 1}>
                    <Text style={[styles.rowValue, hidden && styles.rowValueHidden]}>
                        {hidden ? hiddenLabel : value}
                    </Text>
                </TouchableOpacity>
            </View>
            <View style={styles.rowActions}>
                {onEdit && !hidden ? (
                    <TouchableOpacity onPress={onEdit} style={styles.editBtn} hitSlop={8}>
                        <Ionicons name="pencil-outline" size={16} color={MUTED} />
                    </TouchableOpacity>
                ) : null}
                <Switch
                    value={!hidden}
                    onValueChange={(v) => onToggleVisible(v)}
                    trackColor={{ false: '#E2E8F0', true: '#BFDBFE' }}
                    thumbColor={hidden ? '#94A3B8' : ACCENT}
                />
            </View>
        </View>
    );
}

export function ProfileDetailsSection({
    age,
    genero,
    habitoBebida,
    habitoTabaco,
    privacy,
    onSaveAge,
    onSaveGenero,
    onSaveHabitos,
    onPrivacyChange,
}: Props) {
    const { t } = useT();
    const [editAge, setEditAge] = useState(false);
    const [ageDraft, setAgeDraft] = useState('');
    const [editGenero, setEditGenero] = useState(false);
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
            <Text style={styles.sectionTitle}>{t('profile.details')}</Text>
            <Text style={styles.sectionSub}>{t('profile.detailsSub')}</Text>

            <DetailRow
                label={t('profile.age')}
                value={ageValue}
                hidden={!privacy.mostrar_edad}
                hiddenLabel={t('profile.hidden')}
                showLabel={t('profile.visible')}
                onEdit={() => {
                    setAgeDraft(age != null ? String(age) : '');
                    setEditAge(true);
                }}
                onToggleVisible={(v) => updatePrivacy('mostrar_edad', v)}
            />
            <View style={styles.divider} />
            <DetailRow
                label={t('profile.gender')}
                value={generoValue}
                hidden={!privacy.mostrar_genero}
                hiddenLabel={t('profile.hidden')}
                showLabel={t('profile.visible')}
                onEdit={() => setEditGenero(true)}
                onToggleVisible={(v) => updatePrivacy('mostrar_genero', v)}
            />
            <View style={styles.divider} />
            <DetailRow
                label={t('profile.drinking')}
                value={bebidaValue}
                hidden={!privacy.mostrar_bebida}
                hiddenLabel={t('profile.hidden')}
                showLabel={t('profile.visible')}
                onEdit={() => setEditBebida(true)}
                onToggleVisible={(v) => updatePrivacy('mostrar_bebida', v)}
            />
            <View style={styles.divider} />
            <DetailRow
                label={t('profile.smoking')}
                value={tabacoValue}
                hidden={!privacy.mostrar_tabaco}
                hiddenLabel={t('profile.hidden')}
                showLabel={t('profile.visible')}
                onEdit={() => setEditTabaco(true)}
                onToggleVisible={(v) => updatePrivacy('mostrar_tabaco', v)}
            />

            {/* Editar edad */}
            <Modal visible={editAge} transparent animationType="fade" onRequestClose={() => setEditAge(false)}>
                <Pressable style={styles.modalBg} onPress={() => setEditAge(false)}>
                    <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
                        <Text style={styles.modalTitle}>{t('profile.editAge')}</Text>
                        <TextInput
                            style={styles.modalInput}
                            value={ageDraft}
                            onChangeText={(v) => setAgeDraft(v.replace(/[^0-9]/g, '').slice(0, 2))}
                            keyboardType="number-pad"
                            placeholder="18"
                            autoFocus
                        />
                        <TouchableOpacity
                            style={styles.modalBtn}
                            onPress={() => {
                                const n = parseInt(ageDraft, 10);
                                if (!isValidAge(n)) return;
                                onSaveAge(n);
                                setEditAge(false);
                            }}
                        >
                            <Text style={styles.modalBtnText}>{t('common.save')}</Text>
                        </TouchableOpacity>
                    </Pressable>
                </Pressable>
            </Modal>

            {/* Editar género */}
            <Modal visible={editGenero} transparent animationType="slide" onRequestClose={() => setEditGenero(false)}>
                <Pressable style={styles.modalBg} onPress={() => setEditGenero(false)}>
                    <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
                        <Text style={styles.modalTitle}>{t('profile.editGender')}</Text>
                        <ScrollView>
                            {GENERO_OPTIONS.map((g) => (
                                <TouchableOpacity
                                    key={g}
                                    style={styles.sheetOption}
                                    onPress={() => {
                                        onSaveGenero(g);
                                        setEditGenero(false);
                                    }}
                                >
                                    <Text style={styles.sheetOptionText}>{t('genero.' + g)}</Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </Pressable>
                </Pressable>
            </Modal>

            {/* Editar bebida / tabaco */}
            <Modal visible={editBebida} transparent animationType="slide" onRequestClose={() => setEditBebida(false)}>
                <Pressable style={styles.modalBg} onPress={() => setEditBebida(false)}>
                    <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
                        <Text style={styles.modalTitle}>{t('profile.drinking')}</Text>
                        {HABITO_BEBIDA_OPTIONS.filter((h) => h !== 'no_especificado').map((h) => (
                            <TouchableOpacity
                                key={h}
                                style={styles.sheetOption}
                                onPress={() => {
                                    onSaveHabitos(h, habitoTabaco);
                                    setEditBebida(false);
                                }}
                            >
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
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 18,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: BORDER,
    },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: INK, letterSpacing: -0.2 },
    sectionSub: { fontSize: 13, color: MUTED, marginTop: 4, marginBottom: 16, lineHeight: 18 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    rowMain: { flex: 1 },
    rowLabel: { fontSize: 12, fontWeight: '600', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 },
    rowValue: { fontSize: 16, fontWeight: '600', color: INK, marginTop: 4 },
    rowValueHidden: { color: MUTED, fontStyle: 'italic' },
    rowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    editBtn: { padding: 4 },
    divider: { height: 1, backgroundColor: BORDER },
    modalBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'center', padding: 24 },
    modalBox: { backgroundColor: '#FFF', borderRadius: 16, padding: 20 },
    modalTitle: { fontSize: 17, fontWeight: '700', color: INK, marginBottom: 14 },
    modalInput: {
        fontSize: 28,
        fontWeight: '700',
        textAlign: 'center',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        paddingVertical: 12,
        marginBottom: 16,
        color: INK,
    },
    modalBtn: {
        backgroundColor: ACCENT,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    modalBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
    sheet: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        maxHeight: '50%',
        marginTop: 'auto',
    },
    sheetOption: {
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },
    sheetOptionText: { fontSize: 16, fontWeight: '600', color: INK },
});
