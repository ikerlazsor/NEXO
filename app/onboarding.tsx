import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type Lang, useT } from '../lib/i18n';
import {
    AURA_MAX,
    AURA_MIN,
    CATEGORY_IMAGES,
    MOOD_GRADIENTS,
    MOOD_OPTIONS,
    ONBOARDING_CATEGORIES,
    saveOnboardingPreferences,
    type MoodType,
    type OnboardingCategory,
} from '../lib/onboarding';
import { getAuthUser } from '../lib/auth';
import { resolveDisplayName } from '../lib/profile';

const { width: W } = Dimensions.get('window');
const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';
const TOTAL_STEPS = 3;
const AURA_BARS = 20;

function haptic(type: 'light' | 'medium' | 'success' | 'error' = 'light') {
    if (Platform.OS === 'web') return;
    if (type === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (type === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else Haptics.impactAsync(type === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
}

function toggleCat(list: OnboardingCategory[], item: OnboardingCategory): OnboardingCategory[] {
    if (list.includes(item)) return list.filter((x) => x !== item);
    if (list.length >= 3) return list;
    return [...list, item];
}

export default function OnboardingScreen() {
    const router = useRouter();
    const { t, lang, setLang } = useT();
    const [step, setStep] = useState(0);
    const [saving, setSaving] = useState(false);
    const [categories, setCategories] = useState<OnboardingCategory[]>([]);
    const [mood, setMood] = useState<MoodType | null>(null);
    const [aura, setAura] = useState(500);
    const [auraError, setAuraError] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const fade = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        getAuthUser().then((user) => {
            if (user) setDisplayName(resolveDisplayName(user));
        });
    }, []);

    const goTo = useCallback((next: number) => {
        Animated.sequence([
            Animated.timing(fade, { toValue: 0, duration: 140, useNativeDriver: true }),
            Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }),
        ]).start();
        setTimeout(() => setStep(next), 140);
    }, [fade]);

    const goNext = () => {
        haptic('light');
        if (step === 0) return goTo(1);
        if (step === 1) {
            if (categories.length === 0) return Alert.alert(t('onboarding.notice'), t('onboarding.pickCategory'));
            return goTo(2);
        }
        if (step === 2) {
            if (!mood) return Alert.alert(t('onboarding.notice'), t('onboarding.pickMood'));
            return goTo(3);
        }
    };

    const goBack = () => {
        haptic('light');
        if (step > 0) goTo(step - 1);
    };

    const handleAccess = async () => {
        if (aura < AURA_MIN) {
            haptic('error');
            setAuraError(true);
            return;
        }
        if (saving) return;
        setSaving(true);
        setAuraError(false);
        try {
            const user = await getAuthUser();
            if (!user) {
                router.replace('/login');
                return;
            }
            const { error } = await saveOnboardingPreferences(user.id, {
                categories,
                mood,
                auraScore: aura,
            });
            if (error) {
                Alert.alert(t('onboarding.error'), error);
                return;
            }
            setSaving(false);
            haptic('success');
            router.replace('/(tabs)');
        } catch (e) {
            const msg = e instanceof Error ? e.message : t('onboarding.error');
            Alert.alert(t('onboarding.error'), msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <View style={styles.root}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM, '#FFFFFF']} style={StyleSheet.absoluteFill} />

            <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
                {step > 0 && step <= TOTAL_STEPS && (
                    <View style={styles.topBar}>
                        <Pressable onPress={goBack} style={styles.backBtn} hitSlop={14}>
                            <Ionicons name="chevron-back" size={22} color={INK} />
                        </Pressable>
                        <View style={styles.stepsRow}>
                            {[1, 2, 3].map((n) => (
                                <View key={n} style={[styles.stepDot, step >= n && styles.stepDotActive]} />
                            ))}
                        </View>
                        <Text style={styles.stepLabel}>
                            {t('onboarding.stepOf', { current: String(Math.min(step, TOTAL_STEPS)), total: String(TOTAL_STEPS) })}
                        </Text>
                    </View>
                )}

                <Animated.View style={[styles.body, { opacity: fade }]}>
                    {step === 3 ? (
                        <View style={styles.auraScreen}>
                            <AuraStep
                                value={aura}
                                onChange={(v) => { setAura(v); setAuraError(false); }}
                                displayName={displayName}
                                t={t}
                            />
                            <View style={styles.footer}>
                                {auraError && (
                                    <View style={styles.auraErrorBox}>
                                        <Ionicons name="lock-closed" size={16} color="#DC2626" />
                                        <Text style={styles.auraErrorInline}>{t('onboarding.auraTooLow')}</Text>
                                    </View>
                                )}
                                <PremiumButton
                                    label={t('onboarding.accessNexo')}
                                    onPress={handleAccess}
                                    loading={saving}
                                    variant="primary"
                                />
                            </View>
                        </View>
                    ) : (
                        <>
                            <ScrollView
                                showsVerticalScrollIndicator={false}
                                contentContainerStyle={styles.scroll}
                                bounces={step === 1}
                                keyboardShouldPersistTaps="handled"
                            >
                                {step === 0 && (
                                    <WelcomeStep
                                        lang={lang}
                                        onLang={setLang}
                                        onStart={goNext}
                                        displayName={displayName}
                                        t={t}
                                    />
                                )}
                                {step === 1 && (
                                    <CategoriesStep
                                        selected={categories}
                                        onToggle={(c) => {
                                            haptic('light');
                                            setCategories((p) => toggleCat(p, c));
                                        }}
                                        t={t}
                                    />
                                )}
                                {step === 2 && (
                                    <MoodStep
                                        selected={mood}
                                        onSelect={(m) => { haptic('medium'); setMood(m); }}
                                        t={t}
                                    />
                                )}
                            </ScrollView>
                            {step > 0 && (
                                <View style={styles.footer}>
                                    <PremiumButton label={t('onboarding.continue')} onPress={goNext} variant="primary" />
                                </View>
                            )}
                        </>
                    )}
                </Animated.View>
            </SafeAreaView>
        </View>
    );
}

function NexoLogo() {
    return (
        <View style={styles.logoArea}>
            <Text style={styles.logoWord}>NEXO</Text>
        </View>
    );
}

function WelcomeStep({
    lang, onLang, onStart, displayName, t,
}: {
    lang: Lang;
    onLang: (l: Lang) => void;
    onStart: () => void;
    displayName: string;
    t: (k: string, params?: Record<string, string | number>) => string;
}) {
    const name = displayName || t('profile.user');
    return (
        <View style={styles.welcome}>
            <NexoLogo />

            <Text style={styles.chosenGreeting}>
                {t('onboarding.chosenGreeting', { name })}
            </Text>
            <Text style={styles.chosenSub}>{t('onboarding.chosenSub')}</Text>

            <View style={styles.langRow}>
                <LangFlag code="es" label="ES" active={lang === 'es'} onPress={() => onLang('es')} />
                <View style={styles.langSep} />
                <LangFlag code="en" label="EN" active={lang === 'en'} onPress={() => onLang('en')} />
            </View>

            <View style={styles.welcomeFooter}>
                <PremiumButton label={t('onboarding.start')} onPress={onStart} variant="primary" />
            </View>
        </View>
    );
}

function LangFlag({ code, label, active, onPress }: { code: 'es' | 'en'; label: string; active: boolean; onPress: () => void }) {
    const flag = code === 'es' ? '🇪🇸' : '🇬🇧';
    return (
        <Pressable onPress={onPress} style={[styles.langBtn, active && styles.langBtnActive]}>
            <Text style={styles.langFlag}>{flag}</Text>
            <Text style={[styles.langLabel, active && styles.langLabelActive]}>{label}</Text>
        </Pressable>
    );
}

function CategoryCard({
    cat,
    isSelected,
    atMax,
    onToggle,
    t,
}: {
    cat: OnboardingCategory;
    isSelected: boolean;
    atMax: boolean;
    onToggle: (c: OnboardingCategory) => void;
    t: (k: string) => string;
}) {
    const [imgUri, setImgUri] = useState(CATEGORY_IMAGES[cat]);
    const fallback =
        cat === 'Deporte'
            ? 'https://images.unsplash.com/photo-1517649763962-0c62306601b7?w=900&auto=format&fit=crop&q=85'
            : CATEGORY_IMAGES[cat];

    return (
        <Pressable
            onPress={() => !atMax && onToggle(cat)}
            style={({ pressed }) => [
                styles.catCard,
                isSelected && styles.catCardSelected,
                atMax && styles.catCardDisabled,
                pressed && !atMax && { opacity: 0.92 },
            ]}
        >
            <Image
                source={{ uri: imgUri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                transition={300}
                onError={() => setImgUri(fallback)}
            />
            <LinearGradient
                colors={['rgba(15,42,74,0.05)', 'rgba(15,42,74,0.55)']}
                style={StyleSheet.absoluteFillObject}
            />
            {isSelected && (
                <LinearGradient colors={['rgba(77,166,255,0.35)', 'transparent']} style={StyleSheet.absoluteFillObject} />
            )}
            <View style={styles.catCardInner}>
                <Text style={styles.catName}>{t(`onboarding.cat.${cat}`)}</Text>
                {isSelected && (
                    <View style={styles.catCheck}>
                        <Ionicons name="checkmark" size={14} color="#FFF" />
                    </View>
                )}
            </View>
            {isSelected && <View style={styles.catGoldBorder} pointerEvents="none" />}
        </Pressable>
    );
}

function CategoriesStep({
    selected, onToggle, t,
}: {
    selected: OnboardingCategory[];
    onToggle: (c: OnboardingCategory) => void;
    t: (k: string) => string;
}) {
    return (
        <View>
            <Text style={styles.screenTitle}>{t('onboarding.categoriesTitle')}</Text>
            <Text style={styles.screenHint}>{t('onboarding.categoriesHint')}</Text>
            <View style={styles.catList}>
                {ONBOARDING_CATEGORIES.map((cat) => {
                    const isSelected = selected.includes(cat);
                    const atMax = selected.length >= 3 && !isSelected;
                    return (
                        <CategoryCard
                            key={cat}
                            cat={cat}
                            isSelected={isSelected}
                            atMax={atMax}
                            onToggle={onToggle}
                            t={t}
                        />
                    );
                })}
            </View>
        </View>
    );
}

const MOOD_ICONS: Record<MoodType, keyof typeof Ionicons.glyphMap> = {
    tranqui: 'leaf',
    equilibrado: 'git-branch',
    social: 'people',
};

function MoodStep({
    selected, onSelect, t,
}: {
    selected: MoodType | null;
    onSelect: (m: MoodType) => void;
    t: (k: string) => string;
}) {
    const scales = useRef(
        Object.fromEntries(MOOD_OPTIONS.map((m) => [m, new Animated.Value(m === selected ? 1 : 0)])) as Record<MoodType, Animated.Value>
    ).current;

    useEffect(() => {
        MOOD_OPTIONS.forEach((m) => {
            Animated.spring(scales[m], {
                toValue: selected === m ? 1 : 0,
                friction: 7,
                tension: 120,
                useNativeDriver: true,
            }).start();
        });
    }, [selected, scales]);

    return (
        <View>
            <Text style={styles.screenTitle}>{t('onboarding.moodTitle')}</Text>
            <View style={styles.moodList}>
                {MOOD_OPTIONS.map((m) => {
                    const isSelected = selected === m;
                    const grad = MOOD_GRADIENTS[m];
                    const scale = scales[m].interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });
                    const glowOpacity = scales[m].interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

                    return (
                        <Pressable key={m} onPress={() => onSelect(m)}>
                            <Animated.View style={[styles.moodCardOuter, { transform: [{ scale }] }]}>
                                <Animated.View
                                    style={[
                                        styles.moodGlowRing,
                                        {
                                            opacity: glowOpacity,
                                            borderColor: isSelected ? PRIMARY_DARK : 'transparent',
                                        },
                                    ]}
                                />
                                <View style={[styles.moodCardInner, isSelected && styles.moodCardInnerSelected]}>
                                    {isSelected && (
                                        <LinearGradient
                                            colors={grad}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 1, y: 1 }}
                                            style={StyleSheet.absoluteFillObject}
                                        />
                                    )}
                                    <View style={[styles.moodIconWrap, isSelected && styles.moodIconWrapSelected]}>
                                        <Ionicons
                                            name={MOOD_ICONS[m]}
                                            size={26}
                                            color={isSelected ? PRIMARY_DARK : MUTED}
                                        />
                                    </View>
                                    <View style={styles.moodTextWrap}>
                                        <Text style={[styles.moodName, isSelected && styles.moodNameSelected]}>
                                            {t(`onboarding.mood.${m}`)}
                                        </Text>
                                        <Text style={[styles.moodDesc, isSelected && styles.moodDescSelected]}>
                                            {t(`onboarding.moodDesc.${m}`)}
                                        </Text>
                                    </View>
                                    {isSelected && (
                                        <View style={styles.moodCheck}>
                                            <Ionicons name="checkmark-circle" size={22} color={PRIMARY_DARK} />
                                        </View>
                                    )}
                                </View>
                            </Animated.View>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

function auraColor(value: number): string {
    if (value < AURA_MIN) return '#EF4444';
    if (value < 450) return '#818CF8';
    if (value < 750) return PRIMARY;
    return PRIMARY_DARK;
}

function AuraStep({
    value, onChange, displayName, t,
}: {
    value: number;
    onChange: (v: number) => void;
    displayName: string;
    t: (k: string, params?: Record<string, string | number>) => string;
}) {
    const trackRef = useRef<View>(null);
    const trackLeft = useRef(0);
    const trackWidthRef = useRef(W - 48);
    const [trackWidth, setTrackWidth] = useState(W - 48);
    const lastHaptic = useRef(value);

    const updateFromPageX = useCallback((pageX: number) => {
        const w = trackWidthRef.current;
        if (w <= 0) return;
        const x = pageX - trackLeft.current;
        const clamped = Math.max(0, Math.min(w, x));
        const next = Math.round((clamped / w) * AURA_MAX);
        onChange(next);
        if (Math.abs(next - lastHaptic.current) >= 40) {
            lastHaptic.current = next;
            haptic('light');
        }
    }, [onChange]);

    const measureTrack = useCallback(() => {
        trackRef.current?.measureInWindow((x, _y, width) => {
            trackLeft.current = x;
            trackWidthRef.current = width;
            setTrackWidth(width);
        });
    }, []);

    const pan = useMemo(
        () =>
            PanResponder.create({
                onStartShouldSetPanResponder: () => true,
                onMoveShouldSetPanResponder: () => true,
                onPanResponderTerminationRequest: () => false,
                onShouldBlockNativeResponder: () => true,
                onPanResponderGrant: (e) => {
                    measureTrack();
                    updateFromPageX(e.nativeEvent.pageX);
                },
                onPanResponderMove: (e) => updateFromPageX(e.nativeEvent.pageX),
            }),
        [measureTrack, updateFromPageX]
    );

    const ratio = value / AURA_MAX;
    const color = auraColor(value);
    const filledBars = Math.round(ratio * AURA_BARS);

    const name = displayName || t('profile.user');

    return (
        <View style={styles.auraWrap}>
            <Text style={styles.screenTitle}>{t('onboarding.auraTitle', { name })}</Text>

            <View style={styles.auraMeterCard}>
                <Text style={[styles.auraNumber, { color }]}>{value}</Text>
                <Text style={styles.auraUnit}>{t('onboarding.auraLabel')}</Text>

                <View style={styles.auraBarsRow}>
                    {Array.from({ length: AURA_BARS }, (_, i) => {
                        const active = i < filledBars;
                        const barH = 18 + (i % 5) * 6;
                        return (
                            <View
                                key={i}
                                style={[
                                    styles.auraBar,
                                    {
                                        height: barH,
                                        backgroundColor: active ? color : 'rgba(15,42,74,0.08)',
                                        opacity: active ? 0.35 + (i / AURA_BARS) * 0.65 : 1,
                                    },
                                ]}
                            />
                        );
                    })}
                </View>
            </View>

            <View
                ref={trackRef}
                style={styles.auraTrackHitArea}
                onLayout={measureTrack}
                {...pan.panHandlers}
            >
                <View style={styles.auraTrack}>
                    <LinearGradient
                        colors={['#CBD5E1', PRIMARY, PRIMARY_DARK]}
                        locations={[0, 0.45, 1]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.auraTrackFill, { width: `${ratio * 100}%` }]}
                    />
                </View>
                <View style={[styles.auraThumb, { left: Math.max(0, ratio * trackWidth - 14) }]}>
                    <View style={[styles.auraThumbInner, { borderColor: color }]}>
                        <View style={[styles.auraThumbCore, { backgroundColor: color }]} />
                    </View>
                </View>
            </View>

            <View style={styles.auraScale}>
                <Text style={styles.auraScaleText}>0</Text>
                <Text style={styles.auraScaleText}>{AURA_MAX}</Text>
            </View>
        </View>
    );
}

function PremiumButton({
    label, onPress, loading, variant = 'primary',
}: {
    label: string;
    onPress: () => void;
    loading?: boolean;
    variant?: 'primary';
}) {
    return (
        <Pressable
            onPress={onPress}
            disabled={loading}
            style={({ pressed }) => [styles.premiumBtn, pressed && { opacity: 0.88 }]}
        >
            <LinearGradient
                colors={[PRIMARY, PRIMARY_DARK]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.premiumBtnGrad}
            >
                {loading ? (
                    <ActivityIndicator color="#FFF" />
                ) : (
                    <Text style={styles.premiumBtnText}>{label}</Text>
                )}
            </LinearGradient>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BG_BOTTOM },
    safe: { flex: 1 },
    body: { flex: 1 },
    scroll: { paddingHorizontal: 24, paddingBottom: 16, flexGrow: 1 },
    auraScreen: { flex: 1, paddingHorizontal: 24 },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 12,
        gap: 12,
    },
    backBtn: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: 'rgba(255,255,255,0.85)',
        borderWidth: 1,
        borderColor: 'rgba(77,166,255,0.25)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    stepsRow: { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center' },
    stepDot: { width: 28, height: 3, borderRadius: 2, backgroundColor: 'rgba(15,42,74,0.12)' },
    stepDotActive: { backgroundColor: PRIMARY },
    stepLabel: { fontSize: 11, fontWeight: '600', color: MUTED, letterSpacing: 1 },
    footer: { paddingHorizontal: 24, paddingBottom: 12, paddingTop: 8, gap: 10 },

    welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 520, paddingTop: 20 },
    logoArea: { alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
    logoWord: {
        fontSize: 48,
        fontWeight: '900',
        color: INK,
        letterSpacing: 12,
    },
    chosenGreeting: {
        fontSize: 28,
        fontWeight: '700',
        color: INK,
        letterSpacing: 0.3,
        textAlign: 'center',
        lineHeight: 36,
        paddingHorizontal: 24,
        marginBottom: 14,
    },
    chosenSub: {
        fontSize: 14,
        fontWeight: '500',
        color: MUTED,
        textAlign: 'center',
        letterSpacing: 0.3,
        lineHeight: 22,
        paddingHorizontal: 32,
        marginBottom: 40,
    },
    langRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.75)',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(77,166,255,0.2)',
        padding: 6,
        marginBottom: 48,
    },
    langBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 16,
    },
    langBtnActive: { backgroundColor: 'rgba(77,166,255,0.15)' },
    langSep: { width: 1, height: 24, backgroundColor: 'rgba(15,42,74,0.1)' },
    langFlag: { fontSize: 22 },
    langLabel: { fontSize: 13, fontWeight: '700', color: MUTED, letterSpacing: 2 },
    langLabelActive: { color: PRIMARY_DARK },
    welcomeFooter: { width: '100%' },

    screenTitle: {
        fontSize: 26,
        fontWeight: '800',
        color: INK,
        letterSpacing: -0.3,
        marginBottom: 8,
        marginTop: 8,
    },
    screenHint: {
        fontSize: 13,
        fontWeight: '600',
        color: PRIMARY_DARK,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginBottom: 20,
    },

    catList: { gap: 12 },
    catCard: {
        height: 108,
        borderRadius: 18,
        overflow: 'hidden',
        backgroundColor: '#E8F2FF',
        borderWidth: 1,
        borderColor: 'rgba(77,166,255,0.15)',
    },
    catCardSelected: {},
    catCardDisabled: { opacity: 0.45 },
    catCardInner: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    catName: { flex: 1, fontSize: 20, fontWeight: '800', color: '#FFF', letterSpacing: 0.5, textShadowColor: 'rgba(15,42,74,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
    catCheck: {
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: PRIMARY,
        alignItems: 'center',
        justifyContent: 'center',
    },
    catGoldBorder: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 18,
        borderWidth: 2,
        borderColor: PRIMARY,
    },

    moodList: { gap: 16, marginTop: 16 },
    moodCardOuter: { position: 'relative' },
    moodGlowRing: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 22,
        borderWidth: 2,
        margin: -3,
    },
    moodCardInner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 22,
        minHeight: 96,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(77,166,255,0.15)',
        overflow: 'hidden',
        gap: 18,
        backgroundColor: 'rgba(255,255,255,0.85)',
    },
    moodCardInnerSelected: {
        borderColor: PRIMARY,
    },
    moodIconWrap: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: 'rgba(77,166,255,0.08)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(77,166,255,0.2)',
    },
    moodIconWrapSelected: {
        backgroundColor: 'rgba(255,255,255,0.9)',
    },
    moodTextWrap: { flex: 1 },
    moodName: { fontSize: 20, fontWeight: '800', color: MUTED, letterSpacing: 0.5 },
    moodNameSelected: { color: INK },
    moodDesc: { fontSize: 13, fontWeight: '500', color: MUTED, marginTop: 4 },
    moodDescSelected: { color: 'rgba(15,42,74,0.7)' },
    moodCheck: { marginLeft: 4 },

    auraWrap: { flex: 1, paddingTop: 8 },
    auraMeterCard: {
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.9)',
        borderRadius: 24,
        borderWidth: 1,
        borderColor: 'rgba(77,166,255,0.2)',
        paddingVertical: 28,
        paddingHorizontal: 20,
        marginVertical: 20,
    },
    auraNumber: { fontSize: 56, fontWeight: '900', letterSpacing: -2 },
    auraUnit: { fontSize: 11, fontWeight: '700', color: MUTED, letterSpacing: 3, textTransform: 'uppercase', marginTop: 4, marginBottom: 24 },
    auraBarsRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: 5,
        height: 48,
        width: '100%',
    },
    auraBar: {
        flex: 1,
        maxWidth: 12,
        borderRadius: 4,
    },
    auraTrackHitArea: {
        height: 48,
        justifyContent: 'center',
        marginTop: 8,
    },
    auraTrack: {
        height: 10,
        borderRadius: 5,
        backgroundColor: 'rgba(15,42,74,0.08)',
        overflow: 'hidden',
    },
    auraTrackFill: { height: '100%', borderRadius: 5 },
    auraThumb: { position: 'absolute', top: 10, width: 28, height: 28, borderRadius: 14 },
    auraThumbInner: {
        flex: 1,
        borderRadius: 14,
        backgroundColor: '#FFF',
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: PRIMARY_DARK,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 4,
    },
    auraThumbCore: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    auraScale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 2 },
    auraScaleText: { fontSize: 12, fontWeight: '700', color: MUTED, letterSpacing: 1 },
    auraErrorBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 14,
        borderRadius: 14,
        backgroundColor: 'rgba(239,68,68,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.2)',
    },
    auraErrorInline: { flex: 1, fontSize: 13, fontWeight: '600', color: '#DC2626', lineHeight: 20 },

    premiumBtn: { borderRadius: 18, overflow: 'hidden', shadowColor: PRIMARY_DARK, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
    premiumBtnGrad: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 18,
        borderRadius: 18,
    },
    premiumBtnText: {
        fontSize: 15,
        fontWeight: '800',
        color: '#FFF',
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
});
