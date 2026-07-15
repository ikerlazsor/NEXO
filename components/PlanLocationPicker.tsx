import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { reverseGeocodePlace, searchPlaces, type GeocodeResult } from '../lib/geocoding';
import { useT } from '../lib/i18n';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const PLACEHOLDER = '#94A3B8';
const SEARCH_DEBOUNCE_MS = 280;

export type PlanLocation = {
    latitude: number;
    longitude: number;
    address: string;
};

type SearchResult = GeocodeResult;

interface Props {
    location: PlanLocation;
    onLocationChange: (loc: PlanLocation) => void;
    mapRef: React.RefObject<MapView | null>;
}

export function PlanLocationPicker({ location, onLocationChange, mapRef }: Props) {
    const { t } = useT();
    const [searchText, setSearchText] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [resolvingPin, setResolvingPin] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestIdRef = useRef(0);

    const hasAddress =
        !!location.address?.trim() &&
        location.address !== t('createplan.mapResolving');

    const applyLocation = useCallback(
        (lat: number, lon: number, address: string) => {
            onLocationChange({ latitude: lat, longitude: lon, address });
            mapRef.current?.animateToRegion(
                { latitude: lat, longitude: lon, latitudeDelta: 0.006, longitudeDelta: 0.006 },
                600
            );
            setResults([]);
            setShowSuggestions(false);
        },
        [onLocationChange, mapRef]
    );

    useEffect(() => {
        const q = searchText.trim();
        if (debounceRef.current) clearTimeout(debounceRef.current);

        if (q.length < 2) {
            setResults([]);
            setSearching(false);
            return;
        }

        setSearching(true);
        setShowSuggestions(true);

        debounceRef.current = setTimeout(async () => {
            const requestId = ++requestIdRef.current;
            try {
                const items = await searchPlaces(q, {
                    lat: location.latitude,
                    lon: location.longitude,
                });
                if (requestId !== requestIdRef.current) return;
                setResults(items);
            } catch {
                if (requestId !== requestIdRef.current) return;
                setResults([]);
            } finally {
                if (requestId === requestIdRef.current) setSearching(false);
            }
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [searchText, location.latitude, location.longitude]);

    const onMapPress = async (lat: number, lon: number) => {
        setResolvingPin(true);
        setShowSuggestions(false);
        mapRef.current?.animateToRegion(
            { latitude: lat, longitude: lon, latitudeDelta: 0.006, longitudeDelta: 0.006 },
            400
        );
        onLocationChange({
            latitude: lat,
            longitude: lon,
            address: t('createplan.mapResolving'),
        });
        const address = await reverseGeocodePlace(lat, lon);
        onLocationChange({ latitude: lat, longitude: lon, address });
        setResolvingPin(false);
    };

    const pickResult = (item: SearchResult) => {
        applyLocation(item.latitude, item.longitude, item.subtitle || item.label);
        setSearchText(item.label);
    };

    const clearSearch = () => {
        setSearchText('');
        setResults([]);
        setShowSuggestions(false);
    };

    const showDropdown = showSuggestions && searchText.trim().length >= 2;

    return (
        <View style={styles.wrap}>
            <View style={styles.headerRow}>
                <View style={styles.headerIcon}>
                    <Ionicons name="location" size={22} color="#FFF" />
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{t('createplan.where')}</Text>
                    <Text style={styles.subtitle}>{t('createplan.locationSub')}</Text>
                </View>
            </View>

            <View style={styles.searchWrap}>
                <View style={[styles.searchCard, showDropdown && styles.searchCardOpen]}>
                    <Ionicons name="search" size={20} color={PRIMARY_DARK} />
                    <TextInput
                        placeholder={t('createplan.searchPlace')}
                        placeholderTextColor={PLACEHOLDER}
                        style={styles.searchInput}
                        value={searchText}
                        onChangeText={(text) => {
                            setSearchText(text);
                            if (text.trim().length >= 2) setShowSuggestions(true);
                        }}
                        onFocus={() => {
                            if (searchText.trim().length >= 2) setShowSuggestions(true);
                        }}
                        returnKeyType="search"
                    />
                    {searching ? (
                        <ActivityIndicator size="small" color={PRIMARY_DARK} style={{ marginRight: 4 }} />
                    ) : searchText.length > 0 ? (
                        <Pressable onPress={clearSearch} hitSlop={8} style={styles.clearBtn}>
                            <Ionicons name="close-circle" size={22} color="#94A3B8" />
                        </Pressable>
                    ) : null}
                </View>

                {showDropdown && (
                    <View style={styles.suggestionsDropdown}>
                        {searching && results.length === 0 ? (
                            <View style={styles.suggestionMeta}>
                                <ActivityIndicator size="small" color={PRIMARY_DARK} />
                                <Text style={styles.suggestionMetaText}>
                                    {t('createplan.locationSearching')}
                                </Text>
                            </View>
                        ) : results.length === 0 ? (
                            <View style={styles.suggestionMeta}>
                                <Ionicons name="search-outline" size={18} color="#94A3B8" />
                                <Text style={styles.suggestionMetaText}>
                                    {t('createplan.locationNoResults')}
                                </Text>
                            </View>
                        ) : (
                            <ScrollView
                                keyboardShouldPersistTaps="handled"
                                nestedScrollEnabled
                                style={{ maxHeight: 240 }}
                            >
                                {results.map((item, index) => (
                                    <Pressable
                                        key={item.id}
                                        style={[
                                            styles.suggestionRow,
                                            index < results.length - 1 && styles.suggestionRowBorder,
                                        ]}
                                        onPress={() => pickResult(item)}
                                    >
                                        <View style={styles.suggestionIcon}>
                                            <Ionicons name="location-outline" size={18} color={PRIMARY_DARK} />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.suggestionTitle} numberOfLines={1}>
                                                {item.label}
                                            </Text>
                                            <Text style={styles.suggestionSub} numberOfLines={2}>
                                                {item.subtitle}
                                            </Text>
                                        </View>
                                    </Pressable>
                                ))}
                            </ScrollView>
                        )}
                    </View>
                )}
            </View>

            {hasAddress && (
                <View style={styles.selectedCard}>
                    <View style={styles.selectedIcon}>
                        <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.selectedLabel}>{t('createplan.locationSelected')}</Text>
                        <Text style={styles.selectedAddress} numberOfLines={2}>
                            {location.address}
                        </Text>
                    </View>
                </View>
            )}

            <View style={styles.mapShadow}>
                <View style={styles.mapCard}>
                    <MapView
                        ref={mapRef}
                        style={styles.map}
                        initialRegion={{
                            latitude: location.latitude,
                            longitude: location.longitude,
                            latitudeDelta: 0.01,
                            longitudeDelta: 0.01,
                        }}
                        onPress={(e) =>
                            onMapPress(
                                e.nativeEvent.coordinate.latitude,
                                e.nativeEvent.coordinate.longitude
                            )
                        }
                    >
                        <Marker
                            coordinate={{
                                latitude: location.latitude,
                                longitude: location.longitude,
                            }}
                            pinColor={PRIMARY_DARK}
                        />
                    </MapView>

                    <LinearGradient
                        colors={['transparent', 'rgba(15, 42, 74, 0.55)']}
                        style={styles.mapGradient}
                        pointerEvents="none"
                    />

                    <View style={styles.mapHint} pointerEvents="none">
                        {resolvingPin ? (
                            <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                            <Ionicons name="hand-left-outline" size={14} color="#FFF" />
                        )}
                        <Text style={styles.mapHintText}>{t('createplan.locationTapMap')}</Text>
                    </View>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { padding: 20, backgroundColor: '#F8FAFC', borderBottomWidth: 4, borderBottomColor: '#EEF3FB' },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
    headerIcon: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: PRIMARY_DARK,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: { fontSize: 17, fontWeight: '800', color: INK },
    subtitle: { fontSize: 13, color: '#64748B', marginTop: 3, lineHeight: 18 },
    searchWrap: { position: 'relative', zIndex: 20 },
    searchCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 16,
        paddingLeft: 14,
        paddingRight: 12,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: '#E3ECFB',
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
        gap: 8,
    },
    searchCardOpen: {
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        borderBottomColor: '#F1F5F9',
    },
    searchInput: { flex: 1, fontSize: 15, color: INK, paddingVertical: 12 },
    clearBtn: { padding: 2 },
    suggestionsDropdown: {
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderTopWidth: 0,
        borderColor: '#E3ECFB',
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.12,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
        overflow: 'hidden',
    },
    suggestionRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 12,
        paddingHorizontal: 14,
        gap: 12,
    },
    suggestionRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
    suggestionIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#EFF6FF',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 1,
    },
    suggestionTitle: { fontSize: 15, fontWeight: '700', color: INK },
    suggestionSub: { fontSize: 13, color: '#64748B', marginTop: 3, lineHeight: 18 },
    suggestionMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 16,
        paddingHorizontal: 16,
    },
    suggestionMetaText: { fontSize: 14, color: '#64748B', fontWeight: '500' },
    selectedCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        marginTop: 14,
        backgroundColor: '#ECFDF5',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: '#BBF7D0',
    },
    selectedIcon: { marginTop: 1 },
    selectedLabel: { fontSize: 11, fontWeight: '800', color: '#15803D', textTransform: 'uppercase' },
    selectedAddress: { fontSize: 14, fontWeight: '600', color: '#166534', marginTop: 4, lineHeight: 20 },
    mapShadow: {
        marginTop: 16,
        borderRadius: 22,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
    },
    mapCard: {
        height: 260,
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#E3ECFB',
    },
    map: { ...StyleSheet.absoluteFillObject },
    mapGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 80 },
    mapHint: {
        position: 'absolute',
        bottom: 12,
        left: 12,
        right: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: 'rgba(15, 42, 74, 0.72)',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 12,
    },
    mapHintText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
});
