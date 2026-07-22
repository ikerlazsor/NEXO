import {
    Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams,
    useRouter } from 'expo-router';
import { useEffect,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import DateTimePickerModal from "react-native-modal-datetime-picker";
import type MapView from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PlanCoverPicker } from '../components/PlanCoverPicker';
import { PlanLocationPicker } from '../components/PlanLocationPicker';
import { InvitePeopleSheet, type InviteProfile } from '../components/InvitePeopleSheet';
import { isLocationInSpain } from '../lib/geo';
import { useT } from '../lib/i18n';
import { canJoinMorePlans } from '../lib/planLimits';
import { getPlanPendingInvitees, sendPlanInvite, cancelPlanInvite } from '../lib/planInvites';
import { moderatePlanTitle, type TitleModerationReason } from '../lib/titleModeration';
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

type PlanVisibility = 'public' | 'friends' | 'private';

function minPlanDate(): Date {
    return new Date(Date.now() + MIN_LEAD_MS);
}

export default function CreatePlanScreen() {
    const router = useRouter();
    const { t } = useT();
    const { editId } = useLocalSearchParams(); 
    const mapRef = useRef<MapView>(null);
    const scrollRef = useRef<ScrollView>(null);
    const [loading, setLoading] = useState(false);

    const [title, setTitle] = useState('');
    /** Resultado de moderación del título (mientras rellena el resto del formulario). */
    const [titleCheck, setTitleCheck] = useState<{
        title: string;
        status: 'idle' | 'checking' | 'ok' | 'bad';
        reason: TitleModerationReason | null;
    }>({ title: '', status: 'idle', reason: null });
    const titleCheckGen = useRef(0);
    const [category, setCategory] = useState<MainCategoryId>(MAIN_CATEGORIES[0]);
    const [subcategory, setSubcategory] = useState<string>(SUBCATEGORIES[MAIN_CATEGORIES[0]][0]);
    const [coverIndex, setCoverIndex] = useState(0);
    const categoryImages = getCoverImages(category, subcategory);
    const [maxPeople, setMaxPeople] = useState(5);
    const [description, setDescription] = useState('');
    const [requiereAprobacion, setRequiereAprobacion] = useState(false);
    const [soloChicas, setSoloChicas] = useState(false);
    const [visibility, setVisibility] = useState<PlanVisibility>('public');
    const [pendingInvites, setPendingInvites] = useState<InviteProfile[]>([]);
    const [showInviteSheet, setShowInviteSheet] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [userGenero, setUserGenero] = useState<Genero | null>(null);
    const [joinedCount, setJoinedCount] = useState(0);
    const [originalEventMs, setOriginalEventMs] = useState<number | null>(null);

    const [date, setDate] = useState(() => minPlanDate());
    const [isPickerVisible, setPickerVisible] = useState(false); 
    const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');

    /** Si al editar falta <30 min (o ya pasó), se bloquean título y categoría. */
    const nearStartLock =
        !!editId &&
        originalEventMs != null &&
        originalEventMs - Date.now() < MIN_LEAD_MS;

    const maxDate = new Date();
    maxDate.setMonth(maxDate.getMonth() + 6);

    const [location, setLocation] = useState({
        latitude: 40.416775,
        longitude: -3.703790,
        address: ''
    });

    useEffect(() => {
        supabase.auth.getUser().then(async ({ data: { user } }) => {
            if (!user) return;
            setCurrentUserId(user.id);
            const { data } = await supabase.from('perfiles').select('genero').eq('id', user.id).maybeSingle();
            setUserGenero((data?.genero as Genero) ?? null);
        });
    }, []);

    useEffect(() => {
        if (editId) {
            const loadPlanData = async () => {
                const [{ data, error }, partsRes] = await Promise.all([
                    supabase.from('planes').select('*').eq('id', editId).single(),
                    supabase
                        .from('participantes')
                        .select('usuario_id, estado')
                        .eq('plan_id', String(editId))
                        .eq('estado', 'aceptado'),
                ]);
                if (data && !error) {
                    setTitle(data.titulo ?? '');
                    setDescription(data.descripcion ?? '');
                    const resolved = resolvePlanCategories(data);
                    if (resolved.main) {
                        setCategory(resolved.main);
                        setSubcategory(resolved.sub ?? SUBCATEGORIES[resolved.main][0]);
                    }
                    const joined = partsRes.data?.length ?? 0;
                    setJoinedCount(joined);
                    const loadedMax = Math.min(
                        MAX_PEOPLE,
                        Math.max(Math.max(MIN_PEOPLE, joined), data.maximo_participantes ?? 5),
                    );
                    setMaxPeople(loadedMax);
                    setRequiereAprobacion(!!data.requiere_aprobacion);
                    setSoloChicas(!!data.solo_chicas);
                    setVisibility(
                        data.modo_privado ? 'private' : data.solo_amigos ? 'friends' : 'public',
                    );
                    if (data.modo_privado && editId) {
                        try {
                            const invitees = await getPlanPendingInvitees(String(editId));
                            setPendingInvites(
                                invitees.map((i) => ({
                                    id: i.id,
                                    nombre: i.nombre,
                                    nombre_usuario: i.nombre_usuario,
                                    avatar_url: i.avatar_url,
                                    invitedByName: i.invitadorNombre,
                                })),
                            );
                        } catch {
                            setPendingInvites([]);
                        }
                    }
                    const eventDate = new Date(data.fecha_evento);
                    setDate(eventDate);
                    setOriginalEventMs(eventDate.getTime());
                    setLocation({
                        latitude: data.latitud || 40.416775,
                        longitude: data.longitud || -3.703790,
                        address: data.nombre_ubicacion ?? '',
                    });

                    const img = String(data.imagen_url || '');
                    if (img.startsWith('nexo_cover:')) {
                        const idx = parseInt(img.split(':')[3] || '0', 10);
                        setCoverIndex(Number.isFinite(idx) ? idx : 0);
                    }
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

    // Revisar título 3 s después de dejar de escribir (nunca al instante)
    const TITLE_CHECK_DELAY_MS = 3000;
    useEffect(() => {
        if (nearStartLock) return;

        const trimmed = title.trim();
        if (!trimmed) {
            setTitleCheck({ title: '', status: 'idle', reason: null });
            return;
        }

        const gen = ++titleCheckGen.current;
        // Al escribir: quitar aviso anterior y esperar el delay completo
        setTitleCheck({ title: trimmed, status: 'idle', reason: null });

        const timer = setTimeout(() => {
            if (titleCheckGen.current !== gen) return;
            setTitleCheck({ title: trimmed, status: 'checking', reason: null });
            void moderatePlanTitle(trimmed)
                .then((result) => {
                    if (titleCheckGen.current !== gen) return;
                    setTitleCheck({
                        title: trimmed,
                        status: result.ok ? 'ok' : 'bad',
                        reason: result.reason,
                    });
                })
                .catch(() => {
                    if (titleCheckGen.current !== gen) return;
                    setTitleCheck({ title: trimmed, status: 'ok', reason: null });
                });
        }, TITLE_CHECK_DELAY_MS);

        return () => clearTimeout(timer);
    }, [title, nearStartLock]);

    const selectMainCategory = (main: MainCategoryId) => {
        if (nearStartLock) return;
        setCategory(main);
        setSubcategory(SUBCATEGORIES[main][0]);
        setCoverIndex(0);
    };

    const selectSubcategory = (sub: string) => {
        if (nearStartLock) return;
        setSubcategory(sub);
        setCoverIndex(0);
    };

    const categoryLabel = getPlanCategoryDisplay({ categoria: category, tipo_deporte: subcategory }, t);

    const minEditableMax = Math.max(MIN_PEOPLE, joinedCount || 0);

    const incrementMax = () => {
        if (maxPeople < MAX_PEOPLE) setMaxPeople(maxPeople + 1);
    };
    const decrementMax = () => {
        if (maxPeople > minEditableMax) setMaxPeople(maxPeople - 1);
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
        if (editId && maxPeople < joinedCount) {
            Alert.alert(t('createplan.incomplete'), t('createplan.maxBelowJoined', { n: joinedCount }));
            return;
        }
        if (!isLocationInSpain(location.latitude, location.longitude)) {
            Alert.alert(t('createplan.incomplete'), t('createplan.locationSpainOnly'));
            return;
        }
        if (visibility === 'private' && pendingInvites.length < 1) {
            Alert.alert(t('createplan.incomplete'), t('createplan.needInvite'));
            return;
        }

        // Solo bloquea si la revisión ya terminó y marcó el título actual como malo.
        // Si aún está "checking", se deja pasar (fail-open).
        const trimmedTitle = title.trim();
        if (
            !nearStartLock &&
            titleCheck.status === 'bad' &&
            titleCheck.title === trimmedTitle
        ) {
            Alert.alert(t('createplan.titleBad'), t('createplan.titleBadMsg'));
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
                descripcion: description.trim(),
                nombre_ubicacion: location.address || t('createplan.noLocationName'),
                maximo_participantes: maxPeople,
                imagen_url: imageKey,
                fecha_evento: date.toISOString(),
                latitud: location.latitude,
                longitud: location.longitude,
                requiere_aprobacion: requiereAprobacion,
                solo_chicas: soloChicas,
                solo_amigos: visibility === 'friends',
                modo_privado: visibility === 'private',
            };

            if (!nearStartLock) {
                planPayload.titulo = title.trim();
                planPayload.categoria = category;
                planPayload.tipo_deporte = subcategory;
            }

            if (!editId) {
                planPayload.titulo = title.trim();
                planPayload.categoria = category;
                planPayload.tipo_deporte = subcategory;
                planPayload.creador_id = user.id;
            }

            const savePlan = async (payload: Record<string, unknown>) => {
                if (editId) {
                    return supabase.from('planes').update(payload).eq('id', editId);
                }
                return supabase.from('planes').insert(payload).select().single();
            };

            const result = await savePlan(planPayload);

            if (result.error) throw result.error;

            if (editId) {
                if (visibility === 'private' && pendingInvites.length > 0) {
                    await Promise.all(
                        pendingInvites.map((p) => sendPlanInvite(String(editId), user.id, p.id, 'plan')),
                    );
                }
                router.back();
            } else {
                const planData = 'data' in result ? result.data : null;
                if (!planData?.id) throw new Error('plan_insert_failed');

                const { error: participantError } = await supabase
                    .from('participantes')
                    .insert({ plan_id: planData.id, usuario_id: user.id, estado: 'aceptado' });

                if (participantError) throw participantError;

                if (visibility === 'private' && pendingInvites.length > 0) {
                    await Promise.all(
                        pendingInvites.map((p) => sendPlanInvite(planData.id, user.id, p.id, 'plan')),
                    );
                }

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

                <ScrollView
                    ref={scrollRef}
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                >
                    {nearStartLock ? (
                        <Text style={styles.lockHint}>{t('createplan.nearStartLock')}</Text>
                    ) : null}

                    <PlanCoverPicker
                        category={category}
                        coverKey={`${category}-${subcategory}`}
                        categoryLabel={categoryLabel}
                        images={categoryImages}
                        selectedIndex={coverIndex}
                        onSelectIndex={setCoverIndex}
                    />

                    {!nearStartLock ? (
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
                    ) : (
                        <View style={styles.categorySection}>
                            <Text style={styles.sectionTitle}>{t('createplan.category')}</Text>
                            <Text style={styles.lockedValue}>{categoryLabel}</Text>
                        </View>
                    )}

                    <View style={styles.section}>
                        <View style={styles.labelRow}>
                            <Text style={styles.label}>{t('createplan.planTitle')}</Text>
                            {!nearStartLock ? (
                                <Text style={[styles.charCount, title.length > 30 && {color: DANGER}]}>{title.length}/30</Text>
                            ) : null}
                        </View>
                        {nearStartLock ? (
                            <Text style={styles.lockedTitle}>{title}</Text>
                        ) : (
                        <TextInput 
                            placeholder={t('createplan.titlePlaceholder')} 
                            placeholderTextColor={PLACEHOLDER_COLOR}
                            style={[
                                styles.input,
                                title.length > 30 && styles.inputError,
                                titleCheck.status === 'bad' &&
                                    titleCheck.title === title.trim() &&
                                    styles.inputError,
                            ]} 
                            value={title} onChangeText={setTitle} 
                        />
                        )}
                        {!nearStartLock &&
                        titleCheck.status === 'bad' &&
                        titleCheck.title === title.trim() ? (
                            <Text style={styles.titleBadHint}>{t('createplan.titleBadHint')}</Text>
                        ) : null}

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

                        <Text style={[styles.sectionTitle, { marginTop: 18 }]}>{t('createplan.whoCanSee')}</Text>
                        <View style={styles.visibilityList}>
                            {(
                                [
                                    {
                                        id: 'public' as const,
                                        icon: 'globe-outline' as const,
                                        titleKey: 'createplan.visibilityPublic',
                                    },
                                    {
                                        id: 'friends' as const,
                                        icon: 'people-outline' as const,
                                        titleKey: 'createplan.visibilityFriends',
                                    },
                                    {
                                        id: 'private' as const,
                                        icon: 'lock-closed-outline' as const,
                                        titleKey: 'createplan.visibilityInvitees',
                                    },
                                ] as const
                            ).map((opt) => {
                                const active = visibility === opt.id;
                                return (
                                    <TouchableOpacity
                                        key={opt.id}
                                        style={[styles.visibilityOption, active && styles.visibilityOptionActive]}
                                        onPress={() => {
                                            setVisibility(opt.id);
                                            if (opt.id !== 'private') setPendingInvites([]);
                                            if (opt.id === 'private') {
                                                requestAnimationFrame(() => {
                                                    setTimeout(() => {
                                                        scrollRef.current?.scrollToEnd({ animated: true });
                                                    }, 80);
                                                });
                                            }
                                        }}
                                        activeOpacity={0.85}
                                    >
                                        <View style={[styles.visibilityRadio, active && styles.visibilityRadioActive]}>
                                            {active ? <View style={styles.visibilityRadioDot} /> : null}
                                        </View>
                                        <Text style={[styles.visibilityTitle, active && styles.visibilityTitleActive]}>
                                            {t(opt.titleKey)}
                                        </Text>
                                        <Ionicons
                                            name={opt.icon}
                                            size={20}
                                            color={active ? PRIMARY_DARK : '#94A3B8'}
                                        />
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        {visibility === 'private' ? (
                            <TouchableOpacity
                                style={styles.inviteOpenBtn}
                                onPress={() => setShowInviteSheet(true)}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="person-add" size={20} color="#FFF" />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.inviteOpenBtnText}>{t('invite.openBtn')}</Text>
                                    <Text style={styles.inviteOpenBtnSub}>
                                        {pendingInvites.length > 0
                                            ? t('invite.pendingCount', { n: pendingInvites.length })
                                            : t('invite.noneYet')}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
                            </TouchableOpacity>
                        ) : null}
                    </View>
                </ScrollView>

                <View style={styles.footer}>
                    <TouchableOpacity style={[styles.createBtn, loading && { opacity: 0.7 }]} onPress={handleCreatePlan} disabled={loading}>
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>{editId ? t('createplan.saveChanges') : t('createplan.publish')}</Text>}
                    </TouchableOpacity>
                </View>

                <InvitePeopleSheet
                    visible={showInviteSheet}
                    onClose={() => setShowInviteSheet(false)}
                    currentUserId={currentUserId}
                    selected={pendingInvites}
                    onAdd={(profile) => {
                        setPendingInvites((prev) => (prev.some((p) => p.id === profile.id) ? prev : [...prev, profile]));
                        return { error: null, silent: true };
                    }}
                    onRemove={async (id) => {
                        if (editId) {
                            const { error } = await cancelPlanInvite(String(editId), id);
                            if (!error) {
                                setPendingInvites((prev) => prev.filter((p) => p.id !== id));
                            }
                            return { error };
                        }
                        setPendingInvites((prev) => prev.filter((p) => p.id !== id));
                        return { error: null };
                    }}
                />
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
    lockHint: {
        fontSize: 13,
        fontWeight: '600',
        color: '#92400E',
        backgroundColor: '#FFFBEB',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#FDE68A',
        padding: 12,
        marginBottom: 14,
        lineHeight: 19,
    },
    lockedValue: { fontSize: 15, fontWeight: '700', color: '#1E293B', marginTop: 4 },
    lockedTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: '#1E293B',
        marginBottom: 20,
        paddingVertical: 10,
    },
    input: { fontSize: 16, borderBottomWidth: 1, borderColor: '#E2E8F0', paddingVertical: 12, marginBottom: 20, color: '#1E293B', fontWeight: '500' },
    inputError: { borderColor: DANGER, color: DANGER },
    titleBadHint: {
        marginTop: -8,
        marginBottom: 10,
        fontSize: 13,
        fontWeight: '600',
        color: DANGER,
    },
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
    visibilityList: { gap: 10 },
    visibilityOption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 14,
        borderRadius: 16,
        backgroundColor: '#F8FAFC',
        borderWidth: 2,
        borderColor: '#E2E8F0',
    },
    visibilityOptionActive: {
        borderColor: PRIMARY,
        backgroundColor: '#EFF6FF',
    },
    visibilityRadio: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: '#CBD5E1',
        alignItems: 'center',
        justifyContent: 'center',
    },
    visibilityRadioActive: { borderColor: PRIMARY_DARK },
    visibilityRadioDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: PRIMARY_DARK,
    },
    visibilityTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#64748B' },
    visibilityTitleActive: { color: PRIMARY_DARK },
    inviteOpenBtn: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#1E293B',
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: '#334155',
    },
    inviteOpenBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
    inviteOpenBtnSub: { color: '#94A3B8', fontWeight: '600', fontSize: 12, marginTop: 2 },
    footer: { position: 'absolute', bottom: 0, width: '100%', padding: 20, backgroundColor: '#FFF', borderTopWidth: 1, borderColor: '#F1F5F9' },
    createBtn: { backgroundColor: '#2563EB', padding: 18, borderRadius: 20, alignItems: 'center', elevation: 5, shadowColor: '#2563EB', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
    createBtnText: { color: '#FFF', fontWeight: '800', fontSize: 16, textTransform: 'uppercase', letterSpacing: 1 }
});