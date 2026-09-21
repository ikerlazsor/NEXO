import {
    Ionicons
} from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
    useLocalSearchParams,
    useRouter
} from 'expo-router';
import {
    useEffect,
    useRef,
    useState
} from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Image,
    InteractionManager,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
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
import type MapView from 'react-native-maps';
import DateTimePickerModal from "react-native-modal-datetime-picker";
import { SafeAreaView } from 'react-native-safe-area-context';
import { InvitePeopleSheet, type InviteProfile } from '../components/InvitePeopleSheet';
import { PlanCoverPicker } from '../components/PlanCoverPicker';
import { PlanDayCalendar } from '../components/PlanDayCalendar';
import { PlanLocationPicker } from '../components/PlanLocationPicker';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { getAuthUser } from '../lib/auth';
import { useAuthSession } from '../lib/authSession';
import {
    COVERS_PER_SUB,
    MAIN_CATEGORIES,
    MAIN_CATEGORY_COLORS,
    SUBCATEGORIES,
    SUBCATEGORY_ICONS,
    defaultMaxParticipants,
    encodeCoverImageKey,
    getCoverImages,
    getPlanCategoryDisplay,
    resolvePlanCategories,
    type MainCategoryId,
} from '../lib/categories';
import { FEED_CACHE_KEY } from '../lib/feedCache';
import { injectOptimisticFeedPlan, markFeedNeedsRefresh } from '../lib/feedReload';
import { hapticCelebrate, hapticError, hapticLight, hapticMedium, hapticSelection, hapticSuccess, hapticToggle } from '../lib/haptics';
import { useT } from '../lib/i18n';
import { broadcastPlanMembership } from '../lib/membershipBroadcast';
import { Alert, dismissAllNexoAlerts } from '../lib/nexoAlert';
import { MAX_ORGANIZER_COVERS, uploadOrganizerCover } from '../lib/planCovers';
import { cancelPlanInvite, getPlanPendingInvitees, sendPlanInvite } from '../lib/planInvites';
import { canCreateMorePlans, maxActivePlansFor } from '../lib/planLimits';
import { scheduleCoverPrefetch, warmCoverImages } from '../lib/prefetchCovers';
import { getMyProfile } from '../lib/profileData';
import type { Genero } from '../lib/profileFields';
import { PLAN_DESCRIPTION_MAX } from '../lib/profileSocial';
import { notifyPlanUpdated, schedulePlanLifecycleReminders } from '../lib/push';
import { invalidatePlanMembershipCaches } from '../lib/screenCaches';
import { supabase } from '../lib/supabase';
import { moderatePlanTitle, type TitleModerationReason } from '../lib/titleModeration';
import { cacheInvalidate } from '../lib/ttlCache';
import { type ThemeColors } from '../theme';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const PLACEHOLDER_COLOR = '#94A3B8';
const DANGER = '#EF4444';
const SOLO_PINK = '#DB2777';
const SOLO_PINK_LIGHT = '#FDF2F8';

const MAX_PEOPLE = 25;
const MAX_PEOPLE_ORGANIZER = 800;
const MIN_PEOPLE = 2;
/** No se puede crear un plan con menos de 30 minutos de margen. */
const MIN_LEAD_MS = 30 * 60 * 1000;
/** Hora por defecto al abrir el timer (+1 h). El mínimo sigue siendo 30 min. */
const DEFAULT_LEAD_MS = 60 * 60 * 1000;

type PlanVisibility = 'public' | 'friends' | 'private';

function minPlanDate(): Date {
    return new Date(Date.now() + MIN_LEAD_MS);
}

function defaultPlanDate(): Date {
    return new Date(Date.now() + DEFAULT_LEAD_MS);
}

export default function CreatePlanScreen() {
    const router = useRouter();
    const { t, lang } = useT();
    const { colors, scheme } = useAppTheme();
    const styles = useThemedStyles(createPlanFormStyles);
    const { isGuest, requireAccount } = useAuthSession();

    useEffect(() => {
        if (!isGuest) return;
        requireAccount({ type: 'create-plan' });
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
    }, [isGuest, requireAccount, router]);

    useEffect(() => {
        const task = InteractionManager.runAfterInteractions(() => {
            scheduleCoverPrefetch();
            warmCoverImages(MAIN_CATEGORIES[0], SUBCATEGORIES[MAIN_CATEGORIES[0]][0]);
        });
        return () => task.cancel();
    }, []);
    const { editId, duplicateId } = useLocalSearchParams<{ editId?: string; duplicateId?: string }>();
    const sourcePlanId = editId ? String(editId) : duplicateId ? String(duplicateId) : null;
    const isDuplicate = !!duplicateId && !editId;
    const mapRef = useRef<MapView>(null);
    const scrollRef = useRef<ScrollView>(null);
    const titleFieldRef = useRef<View>(null);
    const descFieldRef = useRef<View>(null);
    const focusedFieldRef = useRef<'title' | 'desc' | null>(null);
    const scrollYRef = useRef(0);
    const keyboardHeightRef = useRef(0);
    const publishingRef = useRef(false);
    const mountedRef = useRef(true);
    const [loading, setLoading] = useState(false);
    /** Aviso visible en pantalla (el Alert nativo queda detrás del modal de crear). */
    const [formBanner, setFormBanner] = useState<string | null>(null);
    const [limitBlocked, setLimitBlocked] = useState(false);
    const [limitChecking, setLimitChecking] = useState(() => !editId);
    const [isOrganizer, setIsOrganizer] = useState(false);
    const [customCovers, setCustomCovers] = useState<string[]>([]);
    const [coverMode, setCoverMode] = useState<'preset' | 'custom'>('preset');
    const holdDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const holdingPeopleRef = useRef(false);
    const peopleTouchRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            publishingRef.current = false;
            if (holdDelayRef.current) clearTimeout(holdDelayRef.current);
            if (holdTimerRef.current) clearInterval(holdTimerRef.current);
        };
    }, []);

    const revealFocusedField = () => {
        const field = focusedFieldRef.current;
        const node = field === 'title'
            ? titleFieldRef.current
            : field === 'desc'
                ? descFieldRef.current
                : null;
        if (!node || !scrollRef.current) return;
        node.measureInWindow((_x, winY, _w, h) => {
            const screenH = Dimensions.get('window').height;
            const footerH = 96;
            const kb = Platform.OS === 'ios' ? keyboardHeightRef.current : 0;
            const visibleBottom = screenH - kb - footerH;
            const overflow = winY + h - visibleBottom;
            if (overflow <= 8 && winY >= 72) return;
            scrollRef.current?.scrollTo({
                y: Math.max(0, scrollYRef.current + overflow + 20),
                animated: true,
            });
        });
    };

    useEffect(() => {
        const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
            keyboardHeightRef.current = e.endCoordinates.height;
            revealFocusedField();
        });
        const hideSub = Keyboard.addListener('keyboardDidHide', () => {
            keyboardHeightRef.current = 0;
        });
        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    // Comprobar límite al abrir (crear / duplicar), no solo al publicar.
    useEffect(() => {
        if (editId) {
            setLimitBlocked(false);
            setLimitChecking(false);
            return;
        }
        let cancelled = false;
        setLimitChecking(true);
        void (async () => {
            try {
                const user = await getAuthUser();
                if (!user || cancelled) return;
                const profile = await getMyProfile();
                const organizer = profile.data?.es_organizador === true;
                if (!cancelled && mountedRef.current) setIsOrganizer(organizer);
                const check = await canCreateMorePlans(user.id, maxActivePlansFor(organizer));
                if (cancelled || !mountedRef.current) return;
                if (!check.allowed) {
                    setLimitBlocked(true);
                    setFormBanner(
                        check.error
                            ? t('createplan.planLimitCheckError')
                            : t('createplan.planLimitReached', { max: check.max }),
                    );
                } else {
                    setLimitBlocked(false);
                }
            } catch {
                if (!cancelled && mountedRef.current) {
                    setLimitBlocked(true);
                    setFormBanner(t('createplan.planLimitCheckError'));
                }
            } finally {
                if (!cancelled && mountedRef.current) setLimitChecking(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [editId, t]);

    useEffect(() => {
        let cancelled = false;
        void getMyProfile().then((profile) => {
            if (!cancelled) setIsOrganizer(profile.data?.es_organizador === true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (isOrganizer) setVisibility('public');
    }, [isOrganizer]);

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
    const [coverIndex, setCoverIndex] = useState(() => Math.floor(Math.random() * COVERS_PER_SUB));
    const categoryImages = getCoverImages(category, subcategory);
    const [maxPeople, setMaxPeople] = useState(() =>
        defaultMaxParticipants(MAIN_CATEGORIES[0], SUBCATEGORIES[MAIN_CATEGORIES[0]][0]),
    );
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
    const [originalPlace, setOriginalPlace] = useState<{
        address: string;
        latitude: number;
        longitude: number;
    } | null>(null);

    const [date, setDate] = useState(() => defaultPlanDate());
    const [isPickerVisible, setPickerVisible] = useState(false);
    const [dayCalendarOpen, setDayCalendarOpen] = useState(false);
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
    /** El pin de Madrid es solo vista inicial; hay que elegir ubicación de verdad. */
    const [locationPicked, setLocationPicked] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(() => !!editId);

    useEffect(() => {
        void getAuthUser().then(async (user) => {
            if (!user) return;
            setCurrentUserId(user.id);
            const { data } = await getMyProfile();
            setUserGenero((data?.genero as Genero) ?? null);
        });
    }, []);

    useEffect(() => {
        if (!sourcePlanId) return;
        const loadPlanData = async () => {
            const [{ data, error }, partsRes] = await Promise.all([
                supabase.from('planes').select('*').eq('id', sourcePlanId).single(),
                editId
                    ? supabase
                          .from('participantes')
                          .select('usuario_id, estado')
                          .eq('plan_id', String(editId))
                          .eq('estado', 'aceptado')
                    : Promise.resolve({ data: [] as { usuario_id: string; estado: string }[] }),
            ]);
            if (data && !error) {
                setTitle(data.titulo ?? '');
                setDescription(data.descripcion ?? '');
                const resolved = resolvePlanCategories(data);
                if (resolved.main) {
                    setCategory(resolved.main);
                    setSubcategory(resolved.sub ?? SUBCATEGORIES[resolved.main][0]);
                }
                const joined = editId ? (partsRes.data?.length ?? 0) : 0;
                setJoinedCount(joined);
                const loadedMax = Math.min(
                    isOrganizer ? MAX_PEOPLE_ORGANIZER : MAX_PEOPLE,
                    Math.max(Math.max(MIN_PEOPLE, joined || MIN_PEOPLE), data.maximo_participantes ?? 5),
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
                } else if (isDuplicate) {
                    setPendingInvites([]);
                }
                const eventDate = new Date(data.fecha_evento);
                if (isDuplicate || eventDate.getTime() < Date.now() + MIN_LEAD_MS) {
                    setDate(defaultPlanDate());
                    setOriginalEventMs(null);
                } else {
                    setDate(eventDate);
                    setOriginalEventMs(eventDate.getTime());
                }
                setLocation({
                    latitude: data.latitud || 40.416775,
                    longitude: data.longitud || -3.703790,
                    address: data.nombre_ubicacion ?? '',
                });
                if (editId) {
                    setOriginalPlace({
                        address: String(data.nombre_ubicacion ?? '').trim(),
                        latitude: Number(data.latitud) || 40.416775,
                        longitude: Number(data.longitud) || -3.703790,
                    });
                } else {
                    setOriginalPlace(null);
                }
                setLocationPicked(
                    Number.isFinite(Number(data.latitud))
                    && Number.isFinite(Number(data.longitud))
                    && String(data.nombre_ubicacion || '').trim().length > 0,
                );

                const extras = Array.isArray(data.imagenes_url)
                    ? (data.imagenes_url as string[]).filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
                    : [];
                const img = String(data.imagen_url || '');
                if (img.startsWith('nexo_cover:')) {
                    const idx = parseInt(img.split(':')[3] || '0', 10);
                    setCoverIndex(Number.isFinite(idx) ? idx : 0);
                }
                const custom = extras.filter((u) => u.startsWith('http'));
                if (custom.length > 0) {
                    setCustomCovers(custom);
                    setCoverMode('custom');
                } else if (img.startsWith('http')) {
                    setCustomCovers([img]);
                    setCoverMode('custom');
                } else {
                    setCoverMode('preset');
                }
            }
        };
        void loadPlanData();
    }, [sourcePlanId, editId, isDuplicate]);

    const peopleCap = isOrganizer ? MAX_PEOPLE_ORGANIZER : MAX_PEOPLE;
    const minEditableMax = Math.max(MIN_PEOPLE, joinedCount || 0);

    useEffect(() => {
        if (editId || isDuplicate) return;
        setMaxPeople(Math.max(MIN_PEOPLE, defaultMaxParticipants(category, subcategory)));
    }, [category, subcategory, editId, isDuplicate]);

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
        const sub = SUBCATEGORIES[main][0];
        setCategory(main);
        setSubcategory(sub);
        requestAnimationFrame(() => {
            if (!editId && !isDuplicate) {
                const covers = getCoverImages(main, sub);
                setCoverIndex(Math.floor(Math.random() * Math.max(1, covers.length)));
            }
            warmCoverImages(main, sub);
        });
    };

    const selectSubcategory = (sub: string) => {
        if (nearStartLock) return;
        setSubcategory(sub);
        requestAnimationFrame(() => {
            if (!editId && !isDuplicate) {
                const covers = getCoverImages(category, sub);
                setCoverIndex(Math.floor(Math.random() * Math.max(1, covers.length)));
            }
            warmCoverImages(category, sub);
        });
    };

    const categoryLabel = getPlanCategoryDisplay({ categoria: category, tipo_deporte: subcategory }, t);

    const applyPeopleDelta = (dir: 1 | -1, step = 1) => {
        setMaxPeople((n) => {
            if (dir === 1) return Math.min(peopleCap, n + step);
            return Math.max(minEditableMax, n - step);
        });
    };

    const stopHoldPeople = () => {
        holdingPeopleRef.current = false;
        if (holdDelayRef.current) {
            clearTimeout(holdDelayRef.current);
            holdDelayRef.current = null;
        }
        if (holdTimerRef.current) {
            clearInterval(holdTimerRef.current);
            holdTimerRef.current = null;
        }
    };

    const startHoldPeople = (dir: 1 | -1) => {
        if (dir === 1 && maxPeople >= peopleCap) return;
        if (dir === -1 && maxPeople <= minEditableMax) return;
        stopHoldPeople();
        holdingPeopleRef.current = true;
        hapticSelection();
        applyPeopleDelta(dir);
        holdDelayRef.current = setTimeout(() => {
            if (!holdingPeopleRef.current) return;
            let ticks = 0;
            holdTimerRef.current = setInterval(() => {
                ticks += 1;
                applyPeopleDelta(dir, ticks > 10 ? 2 : 1);
            }, 170);
        }, 480);
    };

    const spotsHint = t('createplan.spotsHintMax', { max: maxPeople });

    const handleConfirm = (selectedDate: Date) => {
        const min = minPlanDate();
        if (selectedDate.getTime() < min.getTime()) {
            setDate(min);
            setPickerVisible(false);
            showFormError(t('createplan.minLeadTime'));
            return;
        }
        hapticSelection();
        setDate(selectedDate);
        setPickerVisible(false);
    };

    const showMode = (mode: 'date' | 'time') => {
        Keyboard.dismiss();
        hapticMedium();
        setPickerMode(mode);
        setPickerVisible(true);
    };

    // Guardar clave estable del asset (no URI local)
    const getCoverImageKey = () => encodeCoverImageKey(category, subcategory, coverIndex);

    const addCustomCover = async () => {
        if (customCovers.length >= MAX_ORGANIZER_COVERS) return;
        hapticMedium();
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) return;
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.7,
            allowsMultipleSelection: true,
            selectionLimit: MAX_ORGANIZER_COVERS - customCovers.length,
        });
        if (result.canceled) return;
        const next = result.assets.map((a) => a.uri).filter(Boolean);
        setCustomCovers((prev) => [...prev, ...next].slice(0, MAX_ORGANIZER_COVERS));
    };

    const removeCustomCover = (uri: string) => {
        hapticSelection();
        setCustomCovers((prev) => prev.filter((item) => item !== uri));
    };

    const showFormError = (message: string) => {
        hapticError();
        setFormBanner(message);
        // No Alert.alert: create-plan es modal nativo y un Modal encima congela al volver al feed.
    };

    const dismissCreatePlanChrome = () => {
        Keyboard.dismiss();
        setPickerVisible(false);
        setDayCalendarOpen(false);
        setShowInviteSheet(false);
        dismissAllNexoAlerts();
    };

    const leaveCreatePlan = () => {
        publishingRef.current = false;
        mountedRef.current = false;
        dismissCreatePlanChrome();
        try {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)');
        } catch {
            router.replace('/(tabs)');
        }
    };

    const handleCreatePlan = async () => {
        if (publishingRef.current || loading || limitChecking) return;
        hapticMedium();

        if (!editId && limitBlocked) {
            showFormError(t('createplan.planLimitReached', { max: maxActivePlansFor(isOrganizer) }));
            return;
        }

        if (!title.trim() || !description.trim()) {
            showFormError(t('createplan.incompleteMsg'));
            return;
        }
        if (description.trim().length > PLAN_DESCRIPTION_MAX) {
            showFormError(t('createplan.descTooLong', { max: PLAN_DESCRIPTION_MAX }));
            return;
        }
        if (date.getTime() < minPlanDate().getTime()) {
            showFormError(t('createplan.minLeadTime'));
            return;
        }
        if (maxPeople < MIN_PEOPLE) {
            showFormError(t('createplan.incompleteMsg'));
            return;
        }
        if (editId && maxPeople < joinedCount) {
            showFormError(t('createplan.maxBelowJoined', { n: joinedCount }));
            return;
        }
        const locationAddress = location.address.trim();
        const resolvingLabel = t('createplan.mapResolving');
        if (
            !locationPicked ||
            !locationAddress ||
            locationAddress === resolvingLabel ||
            locationAddress === t('createplan.noLocationName')
        ) {
            showFormError(t('createplan.locationRequired'));
            return;
        }
        if (visibility === 'private' && pendingInvites.length < 1) {
            showFormError(t('createplan.needInvite'));
            return;
        }
        if (isOrganizer && coverMode === 'custom' && customCovers.length < 1) {
            showFormError(t('createplan.coverNeedPhoto'));
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
            showFormError(t('createplan.titleBadMsg'));
            return;
        }

        publishingRef.current = true;
        setLoading(true);
        setFormBanner(null);

        try {
            const user = await getAuthUser();
            if (!user) {
                showFormError(t('createplan.saveError'));
                return;
            }
            if (!mountedRef.current) return;

            // Límite ANTES de insertar (si falla el conteo, no publica a ciegas).
            if (!editId) {
                const limitCheck = await canCreateMorePlans(user.id, maxActivePlansFor(isOrganizer));
                if (!mountedRef.current) return;
                if (limitCheck.error) {
                    setLimitBlocked(true);
                    showFormError(t('createplan.planLimitCheckError'));
                    return;
                }
                if (!limitCheck.allowed) {
                    setLimitBlocked(true);
                    showFormError(t('createplan.planLimitReached', { max: limitCheck.max }));
                    return;
                }
            }

            let imageKey = getCoverImageKey();
            let uploadedCovers: string[] = [];
            if (isOrganizer && coverMode === 'custom' && customCovers.length > 0) {
                const selected = customCovers.slice(0, MAX_ORGANIZER_COVERS);
                for (const uri of selected) {
                    if (uri.startsWith('http')) {
                        uploadedCovers.push(uri);
                        continue;
                    }
                    const url = await uploadOrganizerCover(user.id, uri);
                    if (url) uploadedCovers.push(url);
                }
                if (uploadedCovers.length === 0) {
                    showFormError(t('createplan.uploadError'));
                    return;
                }
                if (uploadedCovers.length < selected.length) {
                    showFormError(
                        t('createplan.uploadPartialError', {
                            ok: uploadedCovers.length,
                            total: selected.length,
                        }),
                    );
                    return;
                }
                imageKey = uploadedCovers[0];
            }

            const visibilityForSave = isOrganizer ? 'public' : visibility;

            const planPayload: Record<string, unknown> = {
                descripcion: description.trim(),
                nombre_ubicacion: locationAddress,
                maximo_participantes: maxPeople,
                imagen_url: imageKey,
                imagenes_url: isOrganizer && coverMode === 'custom' ? uploadedCovers : [],
                fecha_evento: date.toISOString(),
                latitud: location.latitude,
                longitud: location.longitude,
                requiere_aprobacion: requiereAprobacion,
                solo_chicas: soloChicas,
                solo_amigos: visibilityForSave === 'friends',
                modo_privado: visibilityForSave === 'private',
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

            if (editId) {
                const { error: updateError } = await supabase
                    .from('planes')
                    .update(planPayload)
                    .eq('id', editId);
                if (!mountedRef.current) return;
                if (updateError) throw updateError;

                const invitees =
                    visibility === 'private' && pendingInvites.length > 0 ? [...pendingInvites] : [];

                const dateChanged =
                    originalEventMs != null &&
                    Math.abs(date.getTime() - originalEventMs) >= 60_000;
                const placeChanged = !!(
                    originalPlace &&
                    (originalPlace.address.trim() !== locationAddress.trim() ||
                        Math.abs(originalPlace.latitude - location.latitude) > 0.0002 ||
                        Math.abs(originalPlace.longitude - location.longitude) > 0.0002)
                );
                if (dateChanged || placeChanged) {
                    const timeLabel = date.toLocaleString(lang === 'en' ? 'en-GB' : 'es-ES', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                    });
                    notifyPlanUpdated({
                        planId: String(editId),
                        changedDate: dateChanged,
                        changedPlace: placeChanged,
                        time: timeLabel,
                        place: locationAddress,
                    });
                }

                hapticSuccess();
                dismissCreatePlanChrome();
                publishingRef.current = false;
                if (mountedRef.current) setLoading(false);

                const editedId = String(editId);
                const editedTitle = title.trim();
                const editedFecha = date.toISOString();
                const editedCategory = category;
                const editedPlace = locationAddress;
                const uid = user.id;
                const shouldReschedule = dateChanged || placeChanged;

                try {
                    if (router.canGoBack()) router.back();
                    else router.replace('/(tabs)');
                } catch {
                    router.replace('/(tabs)');
                }

                setTimeout(() => {
                    markFeedNeedsRefresh({ urgent: true });
                    invalidatePlanMembershipCaches(uid);
                    if (invitees.length > 0) {
                        void Promise.all(
                            invitees.map((p) => sendPlanInvite(editedId, uid, p.id, 'plan')),
                        );
                    }
                    if (shouldReschedule) {
                        void schedulePlanLifecycleReminders({
                            planId: editedId,
                            planTitle: editedTitle,
                            fechaEvento: editedFecha,
                            categoria: editedCategory,
                            locationName: editedPlace,
                        });
                    }
                }, 500);
                return;
            }

            // Crear vía RPC (evita fallo RLS de insert().select())
            const { data: planData, error: createError } = await supabase.rpc('create_meetup_plan', {
                p_payload: planPayload,
            });
            if (!mountedRef.current) return;
            if (createError) throw createError;
            if (!planData?.id) throw new Error('plan_insert_failed');

            const createdPlanId = String(planData.id);
            const createdTitle = title.trim();
            const createdFecha = date.toISOString();
            const createdCategory = category;
            const createdSub = subcategory;
            const createdPlace = locationAddress;
            const createdImage = imageKey;
            const createdCovers =
                isOrganizer && coverMode === 'custom' && uploadedCovers.length > 0
                    ? uploadedCovers
                    : [];
            const createdMax = maxPeople;
            const createdVisibility = visibilityForSave;
            const uid = user.id;
            const invitees =
                visibility === 'private' && pendingInvites.length > 0 ? [...pendingInvites] : [];

            // UI al instante: nada de awaits ni InteractionManager aquí (congelaban el modal).
            hapticCelebrate();
            dismissCreatePlanChrome();
            publishingRef.current = false;
            if (mountedRef.current) setLoading(false);

            injectOptimisticFeedPlan({
                id: createdPlanId,
                titulo: createdTitle,
                descripcion: description.trim(),
                imagen_url: createdImage,
                imagenes_url: createdCovers,
                categoria: createdCategory,
                tipo_deporte: createdSub,
                fecha_evento: createdFecha,
                nombre_ubicacion: createdPlace,
                latitud: location.latitude,
                longitud: location.longitude,
                maximo_participantes: createdMax,
                creador_id: uid,
                requiere_aprobacion: requiereAprobacion,
                solo_chicas: soloChicas,
                solo_amigos: createdVisibility === 'friends',
                modo_privado: createdVisibility === 'private',
                joinedCount: isOrganizer ? 0 : 1,
                participantsList: [],
                host: null,
                es_organizador: isOrganizer,
            });
            // No invalidar el snapshot: inject ya lo parchea; invalidar dejaba el feed vacío un instante.
            broadcastPlanMembership(createdPlanId, isOrganizer ? 'none' : 'joined', {
                userId: uid,
                bumpJoined: !isOrganizer,
            });

            // Salir al feed (replace evita el dismiss del modal + trabajo JS a la vez).
            try {
                router.replace('/(tabs)');
            } catch {
                if (router.canGoBack()) router.back();
                else router.replace('/(tabs)');
            }

            // Todo lo pesado DESPUÉS, con margen para que el modal ya esté cerrado y el feed estable.
            setTimeout(() => {
                markFeedNeedsRefresh({ urgent: true });
                void (async () => {
                    try {
                        if (invitees.length > 0) {
                            await Promise.all(
                                invitees.map((p) => sendPlanInvite(createdPlanId, uid, p.id, 'plan')),
                            );
                        }
                    } catch {
                        /* best-effort */
                    }
                })();
            }, 1100);

            setTimeout(() => {
                void schedulePlanLifecycleReminders({
                    planId: createdPlanId,
                    planTitle: createdTitle,
                    fechaEvento: createdFecha,
                    categoria: createdCategory,
                    locationName: createdPlace,
                });
            }, 1800);
            return;
        } catch (error: unknown) {
            if (__DEV__) console.error(error);
            if (!mountedRef.current) return;
            hapticError();
            const msg = error instanceof Error ? error.message : '';
            Alert.alert(t('profile.error'), t('createplan.saveError') + (msg ? `\n${msg}` : ''));
        } finally {
            publishingRef.current = false;
            if (mountedRef.current) setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
                style={{ flex: 1 }}
            >
                <View style={styles.header}>
                    <Pressable
                        onPress={leaveCreatePlan}
                        style={styles.closeBtn}
                    >
                        <Ionicons name="close" size={28} color={colors.text} />
                    </Pressable>
                    <Text style={styles.headerTitle}>
                        {editId
                            ? t('createplan.edit')
                            : isDuplicate
                              ? t('createplan.duplicate')
                              : t('createplan.create')}
                    </Text>
                    <View style={{ width: 28 }} />
                </View>

                {formBanner ? (
                    <View style={styles.formBannerSticky}>
                        <View style={styles.formBanner}>
                            <Ionicons name="warning" size={18} color="#B45309" />
                            <Text style={styles.formBannerText}>{formBanner}</Text>
                        </View>
                    </View>
                ) : null}

                <ScrollView
                    ref={scrollRef}
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                    automaticallyAdjustKeyboardInsets
                    onScroll={(e) => {
                        scrollYRef.current = e.nativeEvent.contentOffset.y;
                    }}
                    scrollEventThrottle={16}
                >
                    {nearStartLock ? (
                        <Text style={styles.lockHint}>{t('createplan.nearStartLock')}</Text>
                    ) : null}

                    {!nearStartLock ? (
                    <View style={styles.categorySection}>
                        <Text style={styles.sectionTitle}>{t('createplan.category')}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catList} contentContainerStyle={styles.catListContent}>
                            {MAIN_CATEGORIES.map((cat) => {
                                const active = category === cat;
                                const accent = MAIN_CATEGORY_COLORS[cat];
                                return (
                                <TouchableOpacity
                                    key={cat}
                                    onPress={() => selectMainCategory(cat)}
                                    style={[
                                        styles.catBtn,
                                        active && { backgroundColor: accent, borderColor: accent },
                                    ]}
                                    activeOpacity={0.85}
                                >
                                    <Text style={[styles.catText, active && styles.catTextActive]}>
                                        {t(`cat.main.${cat}`)}
                                    </Text>
                                </TouchableOpacity>
                                );
                            })}
                        </ScrollView>

                        <Text style={styles.subSectionLabel}>
                            {t('createplan.pickSubcategory')}
                        </Text>
                        <View style={styles.subGrid}>
                            {SUBCATEGORIES[category].map((sub) => {
                                const accent = MAIN_CATEGORY_COLORS[category];
                                const active = subcategory === sub;
                                return (
                                <TouchableOpacity
                                    key={sub}
                                    onPress={() => selectSubcategory(sub)}
                                    style={[
                                        styles.subBtn,
                                        { borderColor: active ? accent : `${accent}66` },
                                        active && { backgroundColor: accent },
                                    ]}
                                    activeOpacity={0.85}
                                >
                                    <View style={[styles.subIconWrap, active && styles.subIconWrapActive]}>
                                        <Ionicons
                                            name={(SUBCATEGORY_ICONS[sub] ?? 'ellipse') as keyof typeof Ionicons.glyphMap}
                                            size={18}
                                            color={active ? '#FFF' : accent}
                                        />
                                    </View>
                                    <Text style={[styles.subText, { color: active ? '#FFF' : accent }, active && styles.subTextActive]}>
                                        {t(`cat.sub.${sub}`)}
                                    </Text>
                                </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>
                    ) : (
                        <View style={styles.categorySection}>
                            <Text style={styles.sectionTitle}>{t('createplan.category')}</Text>
                            <Text style={styles.lockedValue}>{categoryLabel}</Text>
                        </View>
                    )}

                    {isOrganizer ? (
                        <View style={styles.coverModeWrap}>
                            <View style={styles.coverModeRow}>
                                <TouchableOpacity
                                    style={[styles.coverModeBtn, coverMode === 'preset' && styles.coverModeBtnOn]}
                                    onPress={() => {
                                        hapticMedium();
                                        setCoverMode('preset');
                                    }}
                                    activeOpacity={0.85}
                                >
                                    <Text style={[styles.coverModeText, coverMode === 'preset' && styles.coverModeTextOn]}>
                                        {t('createplan.coverModePick')}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.coverModeBtn, coverMode === 'custom' && styles.coverModeBtnOn]}
                                    onPress={() => {
                                        hapticMedium();
                                        setCoverMode('custom');
                                    }}
                                    activeOpacity={0.85}
                                >
                                    <Text style={[styles.coverModeText, coverMode === 'custom' && styles.coverModeTextOn]}>
                                        {t('createplan.coverModeUpload')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : null}

                    {!isOrganizer || coverMode === 'preset' ? (
                    <PlanCoverPicker
                        category={category}
                        coverKey={`${category}-${subcategory}`}
                        categoryLabel={categoryLabel}
                        images={categoryImages}
                        selectedIndex={coverIndex}
                        onSelectIndex={setCoverIndex}
                        hideTitle={isOrganizer}
                    />
                    ) : (
                        <View style={styles.orgCoverSection}>
                            {customCovers.length > 0 ? (
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.orgCoverRow}>
                                    {customCovers.map((uri, i) => (
                                        <View key={`${uri}-${i}`} style={styles.orgCoverThumbWrap}>
                                            <Image source={{ uri }} style={styles.orgCoverThumb} />
                                            <Pressable style={styles.orgCoverRemove} onPress={() => removeCustomCover(uri)}>
                                                <Ionicons name="close" size={14} color="#FFF" />
                                            </Pressable>
                                        </View>
                                    ))}
                                </ScrollView>
                            ) : null}
                            {customCovers.length < MAX_ORGANIZER_COVERS ? (
                                <Pressable style={styles.orgCoverGalleryBtn} onPress={() => void addCustomCover()}>
                                    <Ionicons name="images" size={22} color={PRIMARY_DARK} />
                                    <Text style={styles.orgCoverGalleryText}>{t('createplan.coverGallery')}</Text>
                                </Pressable>
                            ) : null}
                        </View>
                    )}

                    <View style={[styles.section, styles.copySection]}>
                        <View ref={titleFieldRef} collapsable={false} style={styles.copyBlock}>
                        <View style={styles.copyLabelRow}>
                            <Text style={styles.fieldTitle}>{t('createplan.planTitle')}</Text>
                            {!nearStartLock ? (
                                <Text style={[styles.charCount, title.length > 30 && {color: DANGER}]}>{title.length}/30</Text>
                            ) : null}
                        </View>
                        {nearStartLock ? (
                            <Text style={styles.lockedTitle}>{title}</Text>
                        ) : (
                        <TextInput 
                            testID="plan-title-input"
                            placeholder={t('createplan.titlePlaceholder')} 
                            placeholderTextColor={PLACEHOLDER_COLOR}
                            style={[
                                styles.fieldInput,
                                styles.titleInput,
                                !title.trim() && styles.titleInputEmpty,
                                title.length > 30 && styles.inputError,
                                titleCheck.status === 'bad' &&
                                    titleCheck.title === title.trim() &&
                                    styles.inputError,
                            ]} 
                            value={title} onChangeText={setTitle}
                            autoCapitalize="sentences"
                            autoCorrect={false}
                            autoComplete="off"
                            textContentType="none"
                            importantForAutofill="no"
                            spellCheck={false}
                            onFocus={() => {
                                focusedFieldRef.current = 'title';
                                requestAnimationFrame(() => revealFocusedField());
                            }}
                            onBlur={() => {
                                if (focusedFieldRef.current === 'title') focusedFieldRef.current = null;
                            }}
                        />
                        )}
                        {!nearStartLock &&
                        titleCheck.status === 'bad' &&
                        titleCheck.title === title.trim() ? (
                            <Text style={styles.titleBadHint}>{t('createplan.titleBadHint')}</Text>
                        ) : null}
                        </View>

                        <View ref={descFieldRef} collapsable={false} style={[styles.copyBlock, styles.copyBlockLast]}>
                        <View style={styles.copyLabelRow}>
                            <Text style={styles.fieldTitle}>{t('createplan.description')}</Text>
                            <Text style={[styles.charCount, description.length > PLAN_DESCRIPTION_MAX && {color: DANGER}]}>{description.length}/{PLAN_DESCRIPTION_MAX}</Text>
                        </View>
                        <TextInput 
                            placeholder={t('createplan.descPlaceholder')} 
                            placeholderTextColor={PLACEHOLDER_COLOR}
                            style={[styles.fieldInput, styles.descInput, description.length > PLAN_DESCRIPTION_MAX && styles.inputError]} 
                            multiline value={description} onChangeText={(text) => setDescription(text.slice(0, PLAN_DESCRIPTION_MAX))} 
                            maxLength={PLAN_DESCRIPTION_MAX}
                            onFocus={() => {
                                focusedFieldRef.current = 'desc';
                                requestAnimationFrame(() => revealFocusedField());
                            }}
                            onBlur={() => {
                                if (focusedFieldRef.current === 'desc') focusedFieldRef.current = null;
                            }}
                        />
                        </View>
                    </View>

                    <View style={[styles.section, styles.whenSection]}>
                        <Text style={styles.sectionTitle}>{t('createplan.when')}</Text>
                        <View style={styles.whenCard}>
                            <View style={[styles.dateTimeContainer, { paddingHorizontal: 20 }]}>
                                <TouchableOpacity
                                    style={styles.dateTimeBtn}
                                    onPress={() => {
                                        Keyboard.dismiss();
                                        hapticMedium();
                                        setDayCalendarOpen(true);
                                    }}
                                >
                                    <View style={styles.dateTimeIconWrap}>
                                        <Ionicons name="calendar-outline" size={22} color={PRIMARY} />
                                    </View>
                                    <Text style={styles.dateTimeTimeText}>
                                        {date.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', {
                                            weekday: 'short',
                                            day: 'numeric',
                                            month: 'short',
                                        })}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.dateTimeBtn} onPress={() => showMode('time')}>
                                    <View style={styles.dateTimeIconWrap}>
                                        <Ionicons name="time-outline" size={22} color={PRIMARY} />
                                    </View>
                                    <Text style={styles.dateTimeTimeText}>
                                        {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            <Modal
                                visible={dayCalendarOpen}
                                transparent
                                animationType="fade"
                                onRequestClose={() => setDayCalendarOpen(false)}
                            >
                                <Pressable
                                    style={styles.dayCalBackdrop}
                                    onPress={() => setDayCalendarOpen(false)}
                                >
                                    <Pressable style={styles.dayCalSheet} onPress={(e) => e.stopPropagation()}>
                                        <Text style={styles.dayCalTitle}>{t('createplan.when')}</Text>
                                        <ScrollView
                                            showsVerticalScrollIndicator={false}
                                            bounces={false}
                                            keyboardShouldPersistTaps="handled"
                                        >
                                            <PlanDayCalendar
                                                value={date}
                                                onChange={(next) => {
                                                    hapticMedium();
                                                    const min = minPlanDate();
                                                    setDate(next.getTime() < min.getTime() ? min : next);
                                                    setDayCalendarOpen(false);
                                                }}
                                                days={30}
                                                locale={lang === 'en' ? 'en-GB' : 'es-ES'}
                                                minDate={minPlanDate()}
                                            />
                                        </ScrollView>
                                    </Pressable>
                                </Pressable>
                            </Modal>

                            <DateTimePickerModal
                                isVisible={isPickerVisible}
                                mode="time"
                                onConfirm={handleConfirm}
                                onCancel={() => setPickerVisible(false)}
                                date={date}
                                is24Hour={true}
                                locale={lang === 'en' ? 'en-GB' : 'es-ES'}
                                isDarkModeEnabled={scheme === 'dark'}
                                themeVariant={scheme}
                                textColor={colors.text}
                                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                                pickerContainerStyleIOS={{ backgroundColor: colors.surface }}
                                minimumDate={minPlanDate()}
                                maximumDate={maxDate}
                                confirmTextIOS={t('createplan.confirmDate')}
                                cancelTextIOS={t('createplan.cancelDate')}
                                buttonTextColorIOS={PRIMARY}
                            />
                        </View>
                    </View>

                    <PlanLocationPicker
                        location={location}
                        onLocationChange={(loc) => {
                            setLocationPicked(true);
                            setLocation(loc);
                        }}
                        mapRef={mapRef}
                    />

                    {showAdvanced ? (
                    <>
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>{t('createplan.advancedTitle')}</Text>
                        <Text style={styles.spotsSubLabel}>{t('createplan.maxSpots')}</Text>
                        <View style={styles.peopleSelector}>
                            <Pressable
                                onPressIn={(e) => {
                                    peopleTouchRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
                                    startHoldPeople(-1);
                                }}
                                onTouchMove={(e) => {
                                    if (
                                        Math.abs(e.nativeEvent.pageX - peopleTouchRef.current.x) > 14
                                        || Math.abs(e.nativeEvent.pageY - peopleTouchRef.current.y) > 14
                                    ) {
                                        stopHoldPeople();
                                    }
                                }}
                                onPressOut={stopHoldPeople}
                                hitSlop={12}
                                android_ripple={{ color: '#BFDBFE', borderless: true, radius: 28 }}
                                style={({ pressed }) => [
                                    styles.stepBtn,
                                    pressed && styles.stepBtnPressed,
                                    maxPeople <= minEditableMax && styles.stepBtnDisabled,
                                ]}
                            >
                                <Ionicons name="remove" size={26} color={maxPeople <= minEditableMax ? '#CBD5E1' : PRIMARY} />
                            </Pressable>
                            <Text style={styles.peopleNum}>{maxPeople}</Text>
                            <Pressable
                                onPressIn={(e) => {
                                    peopleTouchRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
                                    startHoldPeople(1);
                                }}
                                onTouchMove={(e) => {
                                    if (
                                        Math.abs(e.nativeEvent.pageX - peopleTouchRef.current.x) > 14
                                        || Math.abs(e.nativeEvent.pageY - peopleTouchRef.current.y) > 14
                                    ) {
                                        stopHoldPeople();
                                    }
                                }}
                                onPressOut={stopHoldPeople}
                                hitSlop={12}
                                android_ripple={{ color: '#BFDBFE', borderless: true, radius: 28 }}
                                style={({ pressed }) => [
                                    styles.stepBtn,
                                    pressed && styles.stepBtnPressed,
                                    maxPeople >= peopleCap && styles.stepBtnDisabled,
                                ]}
                            >
                                <Ionicons name="add" size={26} color={maxPeople >= peopleCap ? '#CBD5E1' : PRIMARY} />
                            </Pressable>
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
                                    onValueChange={(v) => {
                                        hapticToggle(v);
                                        setSoloChicas(v);
                                    }}
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
                                onPress={() => {
                                    hapticSelection();
                                    setRequiereAprobacion(false);
                                }}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="flash" size={22} color={!requiereAprobacion ? PRIMARY : '#94A3B8'} />
                                <Text style={[styles.joinTypeTitle, !requiereAprobacion && { color: PRIMARY }]}>{t('createplan.open')}</Text>
                                <Text style={styles.joinTypeDesc}>{t('createplan.openDesc')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.joinTypeBtn, requiereAprobacion && styles.joinTypeBtnActive]}
                                onPress={() => {
                                    hapticSelection();
                                    setRequiereAprobacion(true);
                                }}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="shield-checkmark" size={22} color={requiereAprobacion ? PRIMARY : '#94A3B8'} />
                                <Text style={[styles.joinTypeTitle, requiereAprobacion && { color: PRIMARY }]}>{t('createplan.requestType')}</Text>
                                <Text style={styles.joinTypeDesc}>{t('createplan.requestDesc')}</Text>
                            </TouchableOpacity>
                        </View>

                        {!isOrganizer ? (
                        <>
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
                                            hapticSelection();
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
                                onPress={() => {
                                    hapticMedium();
                                    setShowInviteSheet(true);
                                }}
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
                        </>
                        ) : null}
                    </View>
                    </>
                    ) : null}
                </ScrollView>

                <View style={styles.footer}>
                    {!editId ? (
                        <TouchableOpacity
                            style={styles.adjustBtn}
                            onPress={() => {
                                hapticSelection();
                                setShowAdvanced((open) => {
                                    const next = !open;
                                    if (next) {
                                        requestAnimationFrame(() => {
                                            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
                                        });
                                    }
                                    return next;
                                });
                            }}
                            activeOpacity={0.88}
                        >
                            <Ionicons
                                name={showAdvanced ? 'chevron-up' : 'options-outline'}
                                size={18}
                                color={PRIMARY_DARK}
                            />
                            <Text style={styles.adjustBtnText} numberOfLines={1}>
                                {showAdvanced ? t('createplan.hideAdjust') : t('createplan.adjust')}
                            </Text>
                        </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                        testID="plan-publish"
                        style={[
                            styles.createBtn,
                            !editId && styles.createBtnFlex,
                            (loading || limitBlocked || limitChecking) && { opacity: 0.7 },
                            limitBlocked && styles.createBtnBlocked,
                        ]}
                        onPress={handleCreatePlan}
                        disabled={loading || limitBlocked || limitChecking}
                    >
                        {loading || limitChecking ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.createBtnText} numberOfLines={1}>
                                {editId ? t('createplan.saveChanges') : t('createplan.publish')}
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>

                <InvitePeopleSheet
                    visible={showInviteSheet}
                    onClose={() => setShowInviteSheet(false)}
                    currentUserId={currentUserId}
                    selected={pendingInvites}
                    onAdd={(profile) => {
                        setPendingInvites((prev) => (prev.some((p) => p.id === profile.id) ? prev : [...prev, profile]));
                    }}
                    onRemove={async (id) => {
                        let removed: InviteProfile | undefined;
                        setPendingInvites((prev) => {
                            removed = prev.find((p) => p.id === id);
                            return prev.filter((p) => p.id !== id);
                        });
                        if (editId) {
                            const { error } = await cancelPlanInvite(String(editId), id);
                            if (error && removed) {
                                setPendingInvites((prev) =>
                                    prev.some((p) => p.id === removed!.id) ? prev : [...prev, removed!],
                                );
                            }
                            return { error };
                        }
                        return { error: null };
                    }}
                />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

function createPlanFormStyles(c: ThemeColors) {
    return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.surface },
    header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, alignItems: 'center' },
    closeBtn: { padding: 8, marginLeft: 2, zIndex: 2 },
    headerTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    scrollContent: { paddingBottom: 120 },
    categorySection: {
        paddingHorizontal: 20,
        paddingTop: 22,
        paddingBottom: 28,
        backgroundColor: c.backgroundAlt,
        borderBottomWidth: 4,
        borderColor: c.background,
    },
    section: { padding: 20, borderBottomWidth: 4, borderColor: c.background },
    copySection: { paddingTop: 18, paddingBottom: 22, gap: 14 },
    copyBlock: {
        backgroundColor: c.surface,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: c.border,
        padding: 16,
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
    },
    copyBlockLast: { marginBottom: 0 },
    sectionTitle: { fontSize: 17, fontWeight: '800', marginBottom: 14, color: c.text },
    subSectionLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: c.textMuted,
        marginTop: 18,
        marginBottom: 12,
    },
    fieldTitle: { fontSize: 14, fontWeight: '800', color: c.text, letterSpacing: 0.1 },
    copyLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    label: { fontSize: 11, color: c.textMuted, fontWeight: '800', textTransform: 'uppercase' },
    charCount: { fontSize: 10, color: c.textSubtle, fontWeight: '600' },
    lockHint: {
        fontSize: 13,
        fontWeight: '600',
        color: '#92400E',
        backgroundColor: c.warningSoft,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#FDE68A',
        padding: 12,
        marginBottom: 14,
        lineHeight: 19,
    },
    lockedValue: { fontSize: 15, fontWeight: '700', color: c.text, marginTop: 4 },
    lockedTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: c.text,
        marginBottom: 20,
        paddingVertical: 10,
    },
    input: {
        fontSize: 16,
        borderBottomWidth: 1,
        borderColor: c.border,
        paddingVertical: 12,
        marginBottom: 20,
        color: c.text,
        fontWeight: '500',
        textTransform: 'none',
        letterSpacing: 0,
        ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
    },
    fieldInput: {
        fontSize: 16,
        borderWidth: 1.5,
        borderColor: c.border,
        borderRadius: 14,
        backgroundColor: c.surfaceSubtle,
        paddingHorizontal: 14,
        paddingVertical: 14,
        color: c.text,
        fontWeight: '600',
        textTransform: 'none',
        letterSpacing: 0,
        ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
    },
    titleInput: {
        fontSize: 17,
        fontWeight: '700',
        letterSpacing: 0,
        ...(Platform.OS === 'ios' ? { lineHeight: 22 } : null),
    },
    /** iOS estira el placeholder si el TextInput va en negrita vacío. */
    titleInputEmpty: {
        fontWeight: '400',
        letterSpacing: 0,
        ...(Platform.OS === 'ios' ? { lineHeight: 22 } : null),
    },
    descInput: { minHeight: 108, textAlignVertical: 'top', marginBottom: 0 },
    whenSection: { paddingTop: 22, paddingBottom: 24 },
    whenCard: {
        backgroundColor: c.surface,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: c.border,
        padding: 14,
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
    },
    dayCalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(15,42,74,0.45)',
        justifyContent: 'center',
        paddingHorizontal: 18,
    },
    dayCalSheet: {
        backgroundColor: c.surface,
        borderRadius: 24,
        paddingHorizontal: 16,
        paddingTop: 18,
        paddingBottom: 20,
        maxHeight: '78%',
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        elevation: 12,
    },
    dayCalTitle: {
        fontSize: 18,
        fontWeight: '900',
        color: c.text,
        marginBottom: 14,
        letterSpacing: -0.3,
    },
    inputError: { borderColor: DANGER, color: DANGER },
    titleBadHint: {
        marginTop: 8,
        fontSize: 13,
        fontWeight: '600',
        color: DANGER,
        lineHeight: 18,
    },
    catList: { flexDirection: 'row' },
    catListContent: { paddingRight: 8, gap: 10 },
    catBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderRadius: 999,
        backgroundColor: c.surface,
        marginRight: 0,
        borderWidth: 1.5,
        borderColor: c.border,
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.05,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
    catText: { color: c.textMuted, fontWeight: '800', fontSize: 14 },
    catTextActive: { color: '#FFF' },
    formatRow: { flexDirection: 'row', gap: 10 },
    formatBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, backgroundColor: c.surfaceSubtle, borderWidth: 1.5, borderColor: c.border },
    formatBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
    formatText: { color: c.textMuted, fontWeight: '800', fontSize: 15 },
    formatTextActive: { color: '#FFF' },
    sportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    subGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    subBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 16,
        backgroundColor: c.surface,
        borderWidth: 1.5,
        borderColor: c.border,
        minWidth: '47%',
        flexGrow: 1,
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.04,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
        elevation: 1,
    },
    subIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 11,
        backgroundColor: c.surfaceSubtle,
        alignItems: 'center',
        justifyContent: 'center',
    },
    subIconWrapActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
    subText: { color: c.text, fontWeight: '700', fontSize: 14, flex: 1 },
    subTextActive: { color: '#FFF' },
    sportBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 14,
        backgroundColor: c.surfaceSubtle,
        borderWidth: 1.5,
        borderColor: c.border,
    },
    sportBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
    sportText: { color: c.textMuted, fontWeight: '800', fontSize: 13 },
    sportTextActive: { color: '#FFF' },
    dateTimeContainer: { flexDirection: 'row', gap: 12 },
    dateTimeBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: c.surfaceSubtle,
        paddingHorizontal: 12,
        paddingVertical: 14,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: c.border,
        minHeight: 68,
    },
    dateTimeIconWrap: {
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: c.surface,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: c.border,
    },
    dateTimeDateText: {
        flex: 1,
        fontSize: 16,
        fontWeight: '800',
        color: c.text,
        letterSpacing: 0.2,
    },
    dateTimeTimeText: {
        flex: 1,
        fontSize: 16,
        fontWeight: '800',
        color: c.text,
        letterSpacing: 0.2,
    },
    peopleSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
    stepBtn: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: PRIMARY, justifyContent: 'center', alignItems: 'center', backgroundColor: c.surface },
    stepBtnPressed: { backgroundColor: c.primarySoft, transform: [{ scale: 0.94 }] },
    stepBtnDisabled: { borderColor: c.border, backgroundColor: c.background },
    peopleNum: { fontSize: 28, fontWeight: '900', marginHorizontal: 35, color: c.text },
    spotsSubLabel: { fontSize: 12, fontWeight: '800', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
    limitsHint: { textAlign: 'center', fontSize: 11, color: c.textSubtle, marginTop: 8 },
    joinTypeRow: { flexDirection: 'row', gap: 12 },
    joinTypeBtn: { flex: 1, alignItems: 'center', paddingVertical: 16, paddingHorizontal: 8, borderRadius: 16, backgroundColor: c.background, borderWidth: 2, borderColor: c.border },
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
    footer: {
        position: 'absolute',
        bottom: 0,
        width: '100%',
        padding: 16,
        paddingBottom: 20,
        backgroundColor: c.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    formBannerSticky: {
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 8,
        backgroundColor: '#FFF',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E2E8F0',
        zIndex: 2,
        elevation: 3,
        shadowColor: '#0F172A',
        shadowOpacity: 0.06,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
    },
    formBanner: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        backgroundColor: c.warningSoft,
        borderWidth: 1,
        borderColor: '#FCD34D',
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 0,
    },
    formBannerText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#92400E', lineHeight: 18 },
    createBtn: { backgroundColor: '#2563EB', padding: 18, borderRadius: 20, alignItems: 'center', elevation: 5, shadowColor: '#2563EB', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, flex: 1 },
    createBtnFlex: { flex: 1.35 },
    createBtnBlocked: { backgroundColor: '#94A3B8', shadowOpacity: 0 },
    createBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15, textTransform: 'uppercase', letterSpacing: 0.4 },
    adjustBtn: {
        flex: 1,
        minHeight: 56,
        borderRadius: 20,
        borderWidth: 2,
        borderColor: PRIMARY,
        backgroundColor: c.surface,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
        paddingHorizontal: 10,
    },
    adjustBtnText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 13 },
    adjustTeaser: {
        marginHorizontal: 20,
        marginTop: 8,
        marginBottom: 16,
        padding: 14,
        borderRadius: 16,
        backgroundColor: c.background,
        borderWidth: 1,
        borderColor: c.border,
    },
    adjustTeaserTitle: { fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 4 },
    adjustTeaserSub: { fontSize: 13, color: c.textMuted, lineHeight: 18 },
    coverModeWrap: { marginBottom: 8, marginTop: 4, paddingHorizontal: 20 },
    orgCoverSection: { marginTop: 4, marginBottom: 14, gap: 10, paddingHorizontal: 20 },
    coverModeRow: {
        flexDirection: 'row',
        backgroundColor: '#F1F5F9',
        borderRadius: 14,
        padding: 4,
        gap: 4,
    },
    coverModeBtn: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        borderRadius: 11,
    },
    coverModeBtnOn: { backgroundColor: c.surface },
    coverModeText: { fontSize: 13, fontWeight: '800', color: '#64748B' },
    coverModeTextOn: { color: '#1E293B' },
    orgCoverGalleryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#EFF6FF',
        borderWidth: 1.5,
        borderColor: '#93C5FD',
        borderRadius: 16,
        paddingVertical: 14,
    },
    orgCoverGalleryText: { fontSize: 15, fontWeight: '800', color: PRIMARY_DARK },
    orgCoverLabel: { fontSize: 14, fontWeight: '800', color: '#1E293B' },
    orgCoverHint: { fontSize: 12, fontWeight: '600', color: '#64748B', lineHeight: 17, marginTop: -2 },
    orgCoverRow: { gap: 10, paddingVertical: 2, paddingRight: 8 },
    orgCoverThumbWrap: { width: 112, height: 148, borderRadius: 18, overflow: 'hidden', backgroundColor: '#E2E8F0' },
    orgCoverAdd: {
        width: 112,
        height: 148,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: '#93C5FD',
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EFF6FF',
        gap: 8,
        paddingHorizontal: 10,
    },
    orgCoverThumb: { width: '100%', height: '100%' },
    orgCoverFirst: {
        position: 'absolute',
        left: 6,
        bottom: 6,
        backgroundColor: 'rgba(15,23,42,0.82)',
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    orgCoverFirstText: { color: '#FFF', fontSize: 9, fontWeight: '800' },
    orgCoverRemove: {
        position: 'absolute',
        top: 6,
        right: 6,
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: 'rgba(15,23,42,0.75)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    orgCoverAddText: { fontSize: 12, fontWeight: '800', color: PRIMARY_DARK, textAlign: 'center' },
    orgRecurrence: { gap: 8 },
    orgRepeatHint: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginTop: 4, lineHeight: 16 },
    });
}
