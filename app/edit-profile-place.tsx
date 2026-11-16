import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { useT } from '../lib/i18n';
import { getUserCoords } from '../lib/location';
import { Alert } from '../lib/nexoAlert';
import {
    getCountriesForContinent,
    getCountryName,
    getDivisionsForCountry,
    getPlaceContinents,
    type PlaceContinentId,
} from '../lib/placeHierarchy';
import { reverseGeocodePlace } from '../lib/profilePlace';
import { publishPlacePick } from '../lib/profilePlacePick';
import { theme, type ThemeColors } from '../theme';

type Step = 'continent' | 'country' | 'division';

export default function EditProfilePlaceScreen() {
    const router = useRouter();
    const { t, lang } = useT();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createStyles);
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ continent?: string; country?: string }>();

    const [step, setStep] = useState<Step>(() => {
        if (typeof params.country === 'string' && params.country) return 'division';
        if (typeof params.continent === 'string' && params.continent) return 'country';
        return 'continent';
    });
    const [continentId, setContinentId] = useState<PlaceContinentId | null>(
        typeof params.continent === 'string' ? (params.continent as PlaceContinentId) : null,
    );
    const [countryCode, setCountryCode] = useState<string | null>(
        typeof params.country === 'string' ? params.country : null,
    );
    const [query, setQuery] = useState('');
    const [locating, setLocating] = useState(false);

    const continents = useMemo(() => getPlaceContinents(), []);
    const countries = useMemo(() => {
        if (!continentId) return [];
        return getCountriesForContinent(continentId, lang === 'en' ? 'en' : 'es');
    }, [continentId, lang]);
    const divisions = useMemo(() => {
        if (!countryCode) return [];
        return getDivisionsForCountry(countryCode);
    }, [countryCode]);

    const title =
        step === 'continent'
            ? t('profile.pickContinent')
            : step === 'country'
              ? t('profile.pickCountry')
              : t('profile.pickRegion');

    const filteredCountries = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return countries;
        return countries.filter((c) => {
            const name = lang === 'en' ? c.nameEn : c.nameEs;
            return name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
        });
    }, [countries, query, lang]);

    const filteredDivisions = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return divisions;
        return divisions.filter((d) => d.name.toLowerCase().includes(q));
    }, [divisions, query]);

    const goBackStep = () => {
        setQuery('');
        if (step === 'division') {
            setCountryCode(null);
            setStep('country');
            return;
        }
        if (step === 'country') {
            setContinentId(null);
            setStep('continent');
            return;
        }
        router.back();
    };

    const selectContinent = (id: PlaceContinentId) => {
        setContinentId(id);
        setQuery('');
        setStep('country');
    };

    const selectCountry = (code: string) => {
        const divs = getDivisionsForCountry(code);
        if (divs.length === 0) {
            const name = getCountryName(code, lang === 'en' ? 'en' : 'es');
            publishPlacePick({ ciudad: name, pais: name });
            router.back();
            return;
        }
        setCountryCode(code);
        setQuery('');
        setStep('division');
    };

    const selectDivision = (name: string) => {
        if (!countryCode) return;
        const countryName = getCountryName(countryCode, lang === 'en' ? 'en' : 'es');
        publishPlacePick({ ciudad: name, pais: countryName });
        router.back();
    };

    const handleMyLocation = async () => {
        if (locating) return;
        setLocating(true);
        try {
            const coords = await getUserCoords({ requestPermission: true, force: true });
            if (!coords) {
                Alert.alert(t('profile.error'), t('profile.useMyLocation'));
                return;
            }
            const place = await reverseGeocodePlace(coords);
            if (!place?.ciudad) {
                Alert.alert(t('profile.error'), t('profile.useMyLocation'));
                return;
            }
            publishPlacePick(place);
            router.back();
        } finally {
            setLocating(false);
        }
    };

    return (
        <View style={styles.root}>
            <LinearGradient colors={[colors.gradientTop, colors.gradientBottom]} style={StyleSheet.absoluteFill} />
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <ScreenHeader compact embedded title={title} onBack={goBackStep} />
                {step !== 'continent' ? (
                    <View style={styles.searchWrap}>
                        <Ionicons name="search" size={18} color={colors.textSubtle} />
                        <TextInput
                            style={styles.searchInput}
                            value={query}
                            onChangeText={setQuery}
                            placeholder={
                                step === 'country' ? t('profile.searchCountry') : t('profile.searchRegion')
                            }
                            placeholderTextColor={colors.textSubtle}
                            autoCorrect={false}
                            autoCapitalize="none"
                            clearButtonMode="while-editing"
                        />
                    </View>
                ) : null}

                <View style={{ flex: 1 }}>
                    {step === 'continent' ? (
                        <FlatList
                            data={continents}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={styles.list}
                            keyboardShouldPersistTaps="handled"
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.row}
                                    onPress={() => selectContinent(item.id)}
                                    activeOpacity={0.85}
                                >
                                    <Text style={styles.rowText}>
                                        {lang === 'en' ? item.nameEn : item.nameEs}
                                    </Text>
                                    <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                                </TouchableOpacity>
                            )}
                        />
                    ) : null}

                    {step === 'country' ? (
                        <FlatList
                            data={filteredCountries}
                            keyExtractor={(item) => item.code}
                            contentContainerStyle={styles.list}
                            keyboardShouldPersistTaps="handled"
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.row}
                                    onPress={() => selectCountry(item.code)}
                                    activeOpacity={0.85}
                                >
                                    <Text style={styles.rowText}>
                                        {lang === 'en' ? item.nameEn : item.nameEs}
                                    </Text>
                                    <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                                </TouchableOpacity>
                            )}
                            ListEmptyComponent={
                                <Text style={styles.empty}>{t('profile.cityNoResults')}</Text>
                            }
                        />
                    ) : null}

                    {step === 'division' ? (
                        <FlatList
                            data={filteredDivisions}
                            keyExtractor={(item) => item.code}
                            contentContainerStyle={styles.list}
                            keyboardShouldPersistTaps="handled"
                            renderItem={({ item }) => (
                                <Pressable style={styles.row} onPress={() => selectDivision(item.name)}>
                                    <Text style={styles.rowText}>{item.name}</Text>
                                </Pressable>
                            )}
                            ListEmptyComponent={
                                <Text style={styles.empty}>{t('profile.cityNoResults')}</Text>
                            }
                        />
                    ) : null}
                </View>

                <View style={[styles.footer, { paddingBottom: Math.max(28, insets.bottom + 16) }]}>
                    <TouchableOpacity
                        style={styles.gpsBtn}
                        onPress={() => void handleMyLocation()}
                        disabled={locating}
                        activeOpacity={0.85}
                    >
                        {locating ? (
                            <ActivityIndicator color="#FFF" />
                        ) : (
                            <>
                                <Ionicons name="navigate" size={22} color="#FFF" />
                                <Text style={styles.gpsText}>{t('profile.useMyLocation')}</Text>
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </View>
    );
}

function createStyles(c: ThemeColors) {
    return StyleSheet.create({
        root: { flex: 1, backgroundColor: c.backgroundAlt },
        searchWrap: {
            marginHorizontal: 16,
            marginBottom: 8,
            paddingHorizontal: 12,
            minHeight: 44,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        searchInput: {
            flex: 1,
            color: c.text,
            fontSize: 15,
            fontWeight: '600',
            paddingVertical: 10,
        },
        list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
        row: {
            minHeight: 52,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
            paddingHorizontal: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
        },
        rowText: {
            flex: 1,
            color: theme.colors.text,
            fontSize: 15,
            fontWeight: '700',
        },
        empty: {
            marginTop: 24,
            textAlign: 'center',
            color: c.textMuted,
            fontWeight: '600',
        },
        footer: {
            paddingHorizontal: 16,
            paddingTop: 10,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
            backgroundColor: c.backgroundAlt,
        },
        gpsBtn: {
            minHeight: 56,
            borderRadius: 16,
            backgroundColor: c.primary,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            paddingHorizontal: 16,
        },
        gpsText: {
            color: '#FFF',
            fontWeight: '800',
            fontSize: 16,
        },
    });
}
