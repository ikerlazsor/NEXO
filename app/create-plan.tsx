import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import DateTimePickerModal from "react-native-modal-datetime-picker";
import type MapView from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PlanCoverPicker } from '../components/PlanCoverPicker';
import { PlanLocationPicker } from '../components/PlanLocationPicker';
import { useT } from '../lib/i18n';
import { canJoinMorePlans } from '../lib/planLimits';
import {
    MAIN_CATEGORIES,
    SUBCATEGORIES,
    SUBCATEGORY_ICONS,
    encodeCoverImageKey,
    getCoverImages,
    getPlanCategoryDisplay,
    normalizeSubcategory,
    resolvePlanCategories,
    type MainCategoryId,
} from '../lib/categories';
import type { Genero } from '../lib/profileFields';
import { supabase } from '../lib/supabase';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const PLACEHOLDER_COLOR = '#94A3B8';
const DANGER = '#EF4444';
const SOLO_PINK = '#DB2777';
const SOLO_PINK_LIGHT = '#FDF2F8';

const MAX_PEOPLE = 25;
const MIN_PEOPLE = 2;
/** No se puede crear un plan con menos de 30 minutos de margen. */
const MIN_LEAD_MS = 30 * 60 * 1000;

function minPlanDate(): Date {
    return new Date(Date.now() + MIN_LEAD_MS);
}

export default function CreatePlanScreen() {
    const router = useRouter();
    const { t } = useT();
    const { editId } = useLocalSearchParams(); 
    const mapRef = useRef<MapView>(null);
    const [loading, setLoading] = useState(false);

    const [title, setTitle] = useState('');
    const [category, setCategory] = useState<MainCategoryId>(MAIN_CATEGORIES[0]);
    const [subcategory, setSubcategory] = useState<string>(SUBCATEGORIES[MAIN_CATEGORIES[0]][0]);
    const [coverIndex, setCoverIndex] = useState(0);
    const categoryImages = getCoverImages(category, subcategory);
    const [maxPeople, setMaxPeople] = useState(5);
    const [description, setDescription] = useState('');
    const [requiereAprobacion, setRequiereAprobacion] = useState(false);
    const [soloChicas, setSoloChicas] = useState(false);
    const [userGenero, setUserGenero] = useState<Genero | null>(null);

    const [date, setDate] = useState(() => minPlanDate());
    const [isPickerVisible, setPickerVisible] = useState(false); 
    const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');

    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 1);

    const [location, setLocation] = useState({
        latitude: 40.416775,
        longitude: -3.703790,
        address: ''
    });

    useEffect(() => {
        supabase.auth.getUser().then(async ({ data: { user } }) => {
            if (!user) return;
            const { data } = await supabase.from('perfiles').select('genero').eq('id', user.id).maybeSingle();
            setUserGenero((data?.genero as Genero) ?? null);
        });
    }, []);

    useEffect(() => {
        if (editId) {
            const loadPlanData = async () => {
                const { data, error } = await supabase.from('planes').select('*').eq('id', editId).single();
                if (data && !error) {
                    setTitle(data.titulo ?? '');
                    setDescription(data.descripcion ?? '');
                    const resolved = resolvePlanCategories(data);
                    if (resolved.main) {
                        setCategory(resolved.main);
                        setSubcategory(resolved.sub ?? SUBCATEGORIES[resolved.main][0]);
                    }
                    const loadedMax = Math.min(MAX_PEOPLE, Math.max(MIN_PEOPLE, data.maximo_participantes ?? 5));
                    setMaxPeople(loadedMax);
                    setRequiereAprobacion(!!data.requiere_aprobacion);
                    setSoloChicas(!!data.solo_chicas);
                    setDate(new Date(data.fecha_evento));
                    setLocation({
                        latitude: data.latitud || 40.416775,
                        longitude: data.longitud || -3.703790,
                        address: data.nombre_ubicacion ?? ''
                    });
                }
            };
            loadPlanData();
        }
    }, [editId]);

    useEffect(() => {
        if (!editId) {
            setCoverIndex(0);
        }
    }, [category, subcategory, editId]);

    const selectMainCategory = (main: MainCategoryId) => {
        setCategory(main);
        setSubcategory(SUBCATEGORIES[main][0]);
        setCoverIndex(0);
    };

    const selectSubcategory = (sub: string) => {
        setSubcategory(sub);
        setCoverIndex(0);
    };

    const categoryLabel = getPlanCategoryDisplay({ categoria: category, tipo_deporte: subcategory }, t);

    const incrementMax = () => {
        if (maxPeople < MAX_PEOPLE) setMaxPeople(maxPeople + 1);
    };
    const decrementMax = () => {
        if (maxPeople > MIN_PEOPLE) setMaxPeople(maxPeople - 1);
    };

    const spotsHint = t('createplan.spotsHintMax', { max: maxPeople });

    const handleConfirm = (selectedDate: Date) => {
        const min = minPlanDate();
        if (selectedDate.getTime() < min.getTime()) {
            setDate(min);
            setPickerVisible(false);
            Alert.alert(t('createplan.incomplete'), t('createplan.minLeadTime'));
            return;
        }
        setDate(selectedDate);
        setPickerVisible(false);
    };

    const showMode = (mode: 'date' | 'time') => {
        setPickerMode(mode);
        setPickerVisible(true);
    };

    // Guardar clave estable del asset (no URI local)
    const getCoverImageKey = () => encodeCoverImageKey(category, subcategory, coverIndex);

    const handleCreatePlan = async () => {
        if (!title.trim() || !description.trim()) {
            Alert.alert(t('createplan.incomplete'), t('createplan.incompleteMsg'));
            return;
        }
        if (date.getTime() < minPlanDate().getTime()) {
            Alert.alert(t('createplan.incomplete'), t('createplan.minLeadTime'));
            return;
        }
        if (maxPeople < MIN_PEOPLE) {
            Alert.alert(t('createplan.incomplete'), t('createplan.incompleteMsg'));
            return;
        }
        try {
            setLoading(true);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            if (!editId) {
                const limitCheck = await canJoinMorePlans(user.id);
                if (!limitCheck.allowed) {
                    Alert.alert(t('createplan.incomplete'), t('feed.planLimitReached', { max: limitCheck.max }));
                    setLoading(false);
                    return;
                }
            }

            const imageKey = getCoverImageKey();

            const planPayload: Record<string, unknown> = {
                titulo: title.trim(),
                descripcion: description.trim(),
                categoria: category,
                nombre_ubicacion: location.address || t('createplan.noLocationName'),
                maximo_participantes: maxPeople,
                imagen_url: imageKey,
                creador_id: user.id,
                fecha_evento: date.toISOString(),
                latitud: location.latitude,
                longitud: location.longitude,
                requiere_aprobacion: requiereAprobacion,
                solo_chicas: soloChicas,
                tipo_deporte: subcategory,
            };

            const savePlan = async (payload: Record<string, unknown>) => {
                if (editId) {
                    return supabase.from('planes').update(payload).eq('id', editId);
                }
                return supabase.from('planes').insert(payload).select().single();
            };

            const result = await savePlan(planPayload);

            if (result.error) throw result.error;

            if (editId) {
                router.back();
            } else {
                const planData = 'data' in result ? result.data : null;
                if (!planData?.id) throw new Error('plan_insert_failed');

                const { error: participantError } = await supabase
                    .from('participantes')
                    .insert({ plan_id: planData.id, usuario_id: user.id, estado: 'aceptado' });

                if (participantError) throw participantError;

                void supabase.from('mensajes').insert({
                    plan_id: planData.id,
                    emisor_id: user.id,
                    contenido: t('chat.planCreated'),
                    tipo: 'texto',
                });

                router.replace('/(tabs)');
            }

        } catch (error: unknown) {
            console.error(error);
            const msg = error instanceof Error ? error.message : '';
            Alert.alert(t('profile.error'), t('createplan.saveError') + (msg ? `\n${msg}` : ''));
        } finally { setLoading(false); }
    };

    return (
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <View style={styles.header}>
                    <Pressable onPress={() => router.back()} style={styles.closeBtn}>
                        <Ionicons name="close" size={28} color="#1E293B" />
                    </Pressable>
                    <Text style={styles.headerTitle}>{editId ? t('createplan.edit') : t('createplan.create')}</Text>
                    <View style={{ width: 28 }} />
                </View>

                <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                    <PlanCoverPicker
                        category={category}
                        coverKey={`${category}-${subcategory}`}
                        categoryLabel={categoryLabel}
                        images={categoryImages}
                        selectedIndex={coverIndex}
                        onSelectIndex={setCoverIndex}
                    />

                    <View style={styles.categorySection}>
                        <Text style={styles.sectionTitle}>{t('createplan.category')}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catList}>
                            {MAIN_CATEGORIES.map((cat) => (
                                <TouchableOpacity
                                    key={cat}
                                    onPress={() => selectMainCategory(cat)}
                                    style={[styles.catBtn, category === cat && styles.catBtnActive]}
                                >
                                    <Text style={[styles.catText, category === cat && styles.catTextActive]}>
                                        {t(`cat.main.${cat}`)}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>

                        <Text style={[styles.label, { marginTop: 16, marginBottom: 10 }]}>
                            {t('createplan.pickSubcategory')}
                        </Text>
                        <View style={styles.subGrid}>
                            {SUBCATEGORIES[category].map((sub) => (
                                <TouchableOpacity
                                    key={sub}
                                    onPress={() => selectSubcategory(sub)}
                                    style={[styles.subBtn, subcategory === sub && styles.subBtnActive]}
                                >
                                    <Ionicons
                                        name={(SUBCATEGORY_ICONS[sub] ?? 'ellipse') as keyof typeof Ionicons.glyphMap}
                                        size={18}
                                        color={subcategory === sub ? '#FFF' : PRIMARY}
                                    />
                                    <Text style={[styles.subText, subcategory === sub && styles.subTextActive]}>
                                        {t(`cat.sub.${sub}`)}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    <View style={styles.section}>
                        <View style={styles.labelRow}>
                            <Text style={styles.label}>{t('createplan.planTitle')}</Text>
                            <Text style={[styles.charCount, title.length > 30 && {color: DANGER}]}>{title.length}/30</Text>
                        </View>
                        <TextInput 
                            placeholder={t('createplan.titlePlaceholder')} 
                            placeholderTextColor={PLACEHOLDER_COLOR}
                            style={[styles.input, title.length > 30 && styles.inputError]} 
                            value={title} onChangeText={setTitle} 
                        />

                        <View style={styles.labelRow}>
                            <Text style={styles.label}>{t('createplan.description')}</Text>
                            <Text style={[styles.charCount, description.length > 250 && {color: DANGER}]}>{description.length}/250</Text>
                        </View>
                        <TextInput 
                            placeholder={t('createplan.descPlaceholder')} 
                            placeholderTextColor={PLACEHOLDER_COLOR}
                            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }, description.length > 250 && styles.inputError]} 
                            multiline value={description} onChangeText={setDescription} 
                        />
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>{t('createplan.when')}</Text>
                        <View style={styles.dateTimeContainer}>
                            <TouchableOpacity style={styles.dateTimeBtn} onPress={() => showMode('date')}>
                                <Ionicons name="calendar-outline" size={20} color={PRIMARY} />
                                <Text style={styles.dateTimeText}>{date.toLocaleDateString()}</Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.dateTimeBtn} onPress={() => showMode('time')}>
                                <Ionicons name="time-outline" size={20} color={PRIMARY} />
                                <Text style={styles.dateTimeText}>
                                    {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        <DateTimePickerModal
                            isVisible={isPickerVisible}
                            mode={pickerMode}
                            onConfirm={handleConfirm}
                            onCancel={() => setPickerVisible(false)}
                            date={date}
                            is24Hour={true}
                            minimumDate={minPlanDate()}
                            maximumDate={maxDate}
                            confirmTextIOS={t('createplan.confirmDate')}
                            cancelTextIOS={t('createplan.cancelDate')}
                            buttonTextColorIOS={PRIMARY}
                        />
                    </View>

                    <PlanLocationPicker
                        location={location}
                        onLocationChange={setLocation}
                        mapRef={mapRef}
                    />

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>{t('createplan.spots')}</Text>

                        <Text style={styles.spotsSubLabel}>{t('createplan.maxSpots')}</Text>
                        <View style={styles.peopleSelector}>
                            <TouchableOpacity
                                onPress={decrementMax}
                                style={[styles.stepBtn, maxPeople <= MIN_PEOPLE && styles.stepBtnDisabled]}
                                disabled={maxPeople <= MIN_PEOPLE}
                            >
                                <Ionicons name="remove" size={24} color={maxPeople <= MIN_PEOPLE ? '#CBD5E1' : PRIMARY} />
                            </TouchableOpacity>
                            <Text style={styles.peopleNum}>{maxPeople}</Text>
                            <TouchableOpacity
                                onPress={incrementMax}
                                style={[styles.stepBtn, maxPeople >= MAX_PEOPLE && styles.stepBtnDisabled]}
                                disabled={maxPeople >= MAX_PEOPLE}
                            >
                                <Ionicons name="add" size={24} color={maxPeople >= MAX_PEOPLE ? '#CBD5E1' : PRIMARY} />
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.limitsHint}>{spotsHint}</Text>
                    </View>

                    {userGenero === 'femenino' ? (
                        <View style={[styles.section, styles.soloChicasSection, soloChicas && styles.soloChicasSectionActive]}>
                            <View style={styles.soloChicasRow}>
                                <View style={styles.soloChicasIconWrap}>
                                    <Ionicons name="female" size={22} color={soloChicas ? SOLO_PINK : '#94A3B8'} />
                                </View>
                                <View style={styles.soloChicasText}>
                                    <Text style={styles.soloChicasTitle}>{t('createplan.soloChicasTitle')}</Text>
                                    <Text style={styles.soloChicasDesc}>{t('createplan.soloChicasDesc')}</Text>
                                </View>
                                <Switch
                                    value={soloChicas}
                                    onValueChange={setSoloChicas}
                                    trackColor={{ false: '#E2E8F0', true: '#F9A8D4' }}
                                    thumbColor={soloChicas ? SOLO_PINK : '#FFF'}
                                />
                            </View>
                        </View>
                    ) : null}

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>{t('createplan.joinHow')}</Text>
                        <View style={styles.joinTypeRow}>
                            <TouchableOpacity
                                style={[styles.joinTypeBtn, !requiereAprobacion && styles.joinTypeBtnActive]}
                                onPress={() => setRequiereAprobacion(false)}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="flash" size={22} color={!requiereAprobacion ? PRIMARY : '#94A3B8'} />
                                <Text style={[styles.joinTypeTitle, !requiereAprobacion && { color: PRIMARY }]}>{t('createplan.open')}</Text>
                                <Text style={styles.joinTypeDesc}>{t('createplan.openDesc')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.joinTypeBtn, requiereAprobacion && styles.joinTypeBtnActive]}
                                onPress={() => setRequiereAprobacion(true)}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="shield-checkmark" size={22} color={requiereAprobacion ? PRIMARY : '#94A3B8'} />
                                <Text style={[styles.joinTypeTitle, requiereAprobacion && { color: PRIMARY }]}>{t('createplan.requestType')}</Text>
                                <Text style={styles.joinTypeDesc}>{t('createplan.requestDesc')}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </ScrollView>

                <View style={styles.footer}>
                    <TouchableOpacity style={[styles.createBtn, loading && { opacity: 0.7 }]} onPress={handleCreatePlan} disabled={loading}>
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>{editId ? t('createplan.saveChanges') : t('createplan.publish')}</Text>}
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#FFF' },
    header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#F1F5F9', alignItems: 'center' },
    closeBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: '800', color: '#1E293B' },
    scrollContent: { paddingBottom: 120 },
    categorySection: {
        paddingHorizontal: 20,
        paddingTop: 22,
        paddingBottom: 20,
        backgroundColor: '#FFF',
        borderBottomWidth: 4,
        borderColor: '#F8FAFC',
    },
    section: { padding: 20, borderBottomWidth: 4, borderColor: '#F8FAFC' },
    sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12, color: '#1E293B' },
    labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    label: { fontSize: 11, color: '#64748B', fontWeight: '800', textTransform: 'uppercase' },
    charCount: { fontSize: 10, color: '#94A3B8', fontWeight: '600' },
    input: { fontSize: 16, borderBottomWidth: 1, borderColor: '#E2E8F0', paddingVertical: 12, marginBottom: 20, color: '#1E293B', fontWeight: '500' },
    inputError: { borderColor: DANGER, color: DANGER },
    catList: { flexDirection: 'row', paddingBottom: 5 },
    catBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9', marginRight: 8, borderWidth: 1, borderColor: '#E2E8F0' },
    catBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
    catText: { color: '#64748B', fontWeight: '700', fontSize: 13 },
    catTextActive: { color: '#FFF' },
    formatRow: { flexDirection: 'row', gap: 10 },
    formatBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, backgroundColor: '#F1F5F9', borderWidth: 1.5, borderColor: '#E2E8F0' },
    formatBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
    formatText: { color: '#64748B', fontWeight: '800', fontSize: 15 },
    formatTextActive: { color: '#FFF' },
    sportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    subGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    subBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 14,
        backgroundColor: '#F1F5F9',
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
        minWidth: '47%',
        flexGrow: 1,
    },
    subBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
    subText: { color: '#64748B', fontWeight: '800', fontSize: 13, flex: 1 },
    subTextActive: { color: '#FFF' },
    sportBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 14,
        backgroundColor: '#F1F5F9',
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
    },
    sportBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
    sportText: { color: '#64748B', fontWeight: '800', fontSize: 13 },
    sportTextActive: { color: '#FFF' },
    dateTimeContainer: { flexDirection: 'row', gap: 12 },
    dateTimeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F1F5F9', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0' },
    dateTimeText: { fontSize: 15, fontWeight: '600', color: '#1E293B' },
    peopleSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
    stepBtn: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: PRIMARY, justifyContent: 'center', alignItems: 'center' },
    stepBtnDisabled: { borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
    peopleNum: { fontSize: 28, fontWeight: '900', marginHorizontal: 35, color: '#1E293B' },
    spotsSubLabel: { fontSize: 12, fontWeight: '800', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
    limitsHint: { textAlign: 'center', fontSize: 11, color: '#94A3B8', marginTop: 8 },
    joinTypeRow: { flexDirection: 'row', gap: 12 },
    joinTypeBtn: { flex: 1, alignItems: 'center', paddingVertical: 16, paddingHorizontal: 8, borderRadius: 16, backgroundColor: '#F8FAFC', borderWidth: 2, borderColor: '#E2E8F0' },
    joinTypeBtnActive: { borderColor: PRIMARY, backgroundColor: '#EFF6FF' },
    joinTypeTitle: { fontSize: 14, fontWeight: '800', color: '#64748B', marginTop: 8 },
    joinTypeDesc: { fontSize: 11, color: '#94A3B8', marginTop: 2, textAlign: 'center' },
    soloChicasSection: {
        backgroundColor: '#FFF',
        borderWidth: 1.5,
        borderColor: '#FCE7F3',
    },
    soloChicasSectionActive: {
        backgroundColor: SOLO_PINK_LIGHT,
        borderColor: '#F9A8D4',
    },
    soloChicasRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    soloChicasIconWrap: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: '#FFF',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#FBCFE8',
    },
    soloChicasText: { flex: 1 },
    soloChicasTitle: { fontSize: 15, fontWeight: '800', color: '#831843' },
    soloChicasDesc: { fontSize: 12, color: '#9D174D', marginTop: 3, lineHeight: 17 },
    footer: { position: 'absolute', bottom: 0, width: '100%', padding: 20, backgroundColor: '#FFF', borderTopWidth: 1, borderColor: '#F1F5F9' },
    createBtn: { backgroundColor: '#2563EB', padding: 18, borderRadius: 20, alignItems: 'center', elevation: 5, shadowColor: '#2563EB', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
    createBtnText: { color: '#FFF', fontWeight: '800', fontSize: 16, textTransform: 'uppercase', letterSpacing: 1 }
});