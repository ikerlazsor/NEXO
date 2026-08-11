/*
perfil del usuario
*/
import { Ionicons } from "@expo/vector-icons";
import { decode } from "base64-arraybuffer";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  InteractionManager,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Alert } from "../lib/nexoAlert";
import { styles } from "../features/profile/profileStyles";
import { PersonalityPickerModal } from "../features/profile/PersonalityPickerModal";
import type { ProfileUiSnapshot, QuickAction } from "../features/profile/types";
import { SafeAreaView } from "react-native-safe-area-context";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { ProfileReputationStats } from "../components/ProfileReputationStats";
import { BadgeDetailModal, BadgeTile } from "../components/TrophyBadge";
import { ProfileDetailsSection } from "../components/ProfileDetailsSection";
import { getFriendsCount } from "../lib/friends";
import { useT } from "../lib/i18n";
import { getProfileNotificationCount } from "../lib/notifications";
import { getAuthUser } from "../lib/auth";
import { formatCountdown } from "../lib/planLifecycle";
import { warmFriendsAndSavedPlans } from "../lib/prefetchHome";
import { getPendingRatingPlans, type PendingRatingPlan } from "../lib/ratings";
import {
  deleteAccount,
  DISPLAY_NAME_MAX_LENGTH,
  isUsernameTaken,
  isValidDisplayName,
  isValidUsername,
  normalizeDisplayName,
  formatUsernameInput,
  normalizeUsername,
  loadProfileRow,
  resolveDisplayName,
  syncProfileFromAuth,
  updateDisplayName,
  updateProfileFields,
  updateUsername,
  getUsernameCooldownDaysLeft,
  USERNAME_MAX_LENGTH,
} from "../lib/profile";
import { screenCacheKey, ScreenCacheTTL } from "../lib/screenCaches";
import { cacheGetStale, cacheSet } from "../lib/ttlCache";
import { renderRatingStars } from "../lib/profileRating";
import {
  EMPTY_STATS,
  formatRatingScore,
  getUserStats,
  type UserStats,
} from "../lib/stats";
import { getUserBadges, type UserBadge } from "../lib/badges";
import { getBadgeStats } from "../lib/badgeStats";
import { perfEnd, perfStart, perfTimed } from "../lib/perfLog";
import {
  calcAge,
  getPersonalityLabel,
  parseHabitos,
  mergePerfilGustosPrivacy,
  parsePrivacy,
  type Genero,
  type HabitoConsumo,
  type ProfilePrivacy,
} from "../lib/profileFields";
import { supabase } from "../lib/supabase";
import { useScrollViewRestore } from "../hooks/useScrollViewRestore";
import { ScreenKeys } from "../lib/screenState";

const PRIMARY = "#4DA6FF";
const PRIMARY_DARK = "#2563EB";
const INK = "#0F2A4A";
const MUTED = "#64748B";
const BG = "#F8FAFC";
const SURFACE = "#FFFFFF";
const BORDER = "#E2E8F0";

const PERSONALITY_MAX = 3;

export default function ProfileScreen() {
  const router = useRouter();
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [nombre, setNombre] = useState("");
  const [nombreUsuario, setNombreUsuario] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameCooldownDays, setUsernameCooldownDays] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [friendsCount, setFriendsCount] = useState(0);
  const [friendsNotifCount, setFriendsNotifCount] = useState(0);
  const [planRequests, setPlanRequests] = useState(0);
  const [pendingRatings, setPendingRatings] = useState<PendingRatingPlan[]>([]);
  const [nowTick, setNowTick] = useState(Date.now());
  const [aboutMe, setAboutMe] = useState("");
  const [isEditingAboutMe, setIsEditingAboutMe] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [stats, setStats] = useState<UserStats>(EMPTY_STATS);
  const [age, setAge] = useState<number | null>(null);
  const [genero, setGenero] = useState<Genero | null>(null);
  const [habitoBebida, setHabitoBebida] =
    useState<HabitoConsumo>("no_especificado");
  const [habitoTabaco, setHabitoTabaco] =
    useState<HabitoConsumo>("no_especificado");
  const [aficiones, setAficiones] = useState<string[]>([]);
  const [showAficionModal, setShowAficionModal] = useState(false);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [badgesLoading, setBadgesLoading] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState<UserBadge | null>(null);
  const [privacy, setPrivacy] = useState<ProfilePrivacy>({
    mostrar_edad: true,
    mostrar_genero: true,
    mostrar_bebida: true,
    mostrar_tabaco: true,
    mostrar_aficiones: true,
  });
  const [perfilGustos, setPerfilGustos] = useState<Record<string, unknown>>({});
  const hasHydratedRef = useRef(false);
  const { scrollRef, onScroll, scrollEventThrottle } = useScrollViewRestore(
    ScreenKeys.PROFILE,
  );

  const applyProfileSnapshot = useCallback((snap: ProfileUiSnapshot) => {
    setNombre(snap.nombre);
    setNombreUsuario(snap.nombreUsuario);
    setAboutMe(snap.aboutMe);
    setAvatarUrl(snap.avatarUrl);
    setAge(snap.age);
    setGenero(snap.genero);
    setHabitoBebida(snap.habitoBebida);
    setHabitoTabaco(snap.habitoTabaco);
    setAficiones(snap.aficiones);
    setPerfilGustos(snap.perfilGustos);
    setPrivacy(snap.privacy);
    setStats(snap.stats);
    setFriendsCount(snap.friendsCount);
    setFriendsNotifCount(snap.friendsNotifCount);
    setPlanRequests(snap.planRequests);
    setPendingRatings(snap.pendingRatings);
    setBadges(snap.badges);
    setBadgesLoading(false);
    hasHydratedRef.current = true;
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchUserData();
      // Precargar Amigos / Guardados mientras estás en perfil (antes de entrar).
      warmFriendsAndSavedPlans();
    }, []),
  );

  useEffect(() => {
    if (!pendingRatings.some((p) => p.phase === "waiting")) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pendingRatings]);

  const fetchUserData = async () => {
    perfStart("profile.total");
    const authUser = await getAuthUser();
    if (!authUser) return;

    setUser(authUser);

    const stale = cacheGetStale<ProfileUiSnapshot>(
      screenCacheKey.profileUI(authUser.id),
    );
    if (stale && stale.userId === authUser.id) {
      applyProfileSnapshot(stale);
    } else if (!hasHydratedRef.current) {
      setBadgesLoading(true);
    }

    const applyProfileFields = (profile: {
      nombre: string;
      nombre_usuario: string | null;
      avatar_url: string | null;
      descripcion: string;
      etiquetas: string[];
      fecha_nacimiento: string | null;
      genero: string | null;
      habitos_consumo: Record<string, unknown>;
      ambientes_preferidos: string[];
      perfil_gustos: Record<string, unknown>;
    }) => {
      setNombre(profile.nombre);
      setNombreUsuario(profile.nombre_usuario);
      setAboutMe(profile.descripcion);
      setAvatarUrl(profile.avatar_url);
      setAge(calcAge(profile.fecha_nacimiento));
      setGenero((profile.genero as Genero) || null);
      const habitos = parseHabitos(profile.habitos_consumo);
      setHabitoBebida(habitos.bebida);
      setHabitoTabaco(habitos.tabaco);
      setAficiones(
        profile.ambientes_preferidos?.length
          ? profile.ambientes_preferidos
          : profile.etiquetas,
      );
      setPerfilGustos(profile.perfil_gustos);
      setPrivacy(parsePrivacy(profile.perfil_gustos));
    };

    const row = await perfTimed("profile.loadRow", () =>
      loadProfileRow(authUser.id),
    );
    let profileFields: {
      nombre: string;
      nombre_usuario: string | null;
      avatar_url: string | null;
      descripcion: string;
      etiquetas: string[];
      fecha_nacimiento: string | null;
      genero: string | null;
      habitos_consumo: Record<string, unknown>;
      ambientes_preferidos: string[];
      perfil_gustos: Record<string, unknown>;
    };

    if (row.data) {
      profileFields = {
        nombre: row.data.nombre?.trim() || resolveDisplayName(authUser),
        nombre_usuario: row.data.nombre_usuario ?? null,
        avatar_url:
          row.data.avatar_url ??
          (typeof authUser.user_metadata?.avatar_url === "string"
            ? authUser.user_metadata.avatar_url
            : null),
        descripcion: row.data.descripcion ?? "",
        etiquetas: row.data.etiquetas ?? [],
        fecha_nacimiento: row.data.fecha_nacimiento ?? null,
        genero: row.data.genero ?? null,
        habitos_consumo:
          (row.data.habitos_consumo as Record<string, unknown>) ?? {},
        ambientes_preferidos: row.data.ambientes_preferidos ?? [],
        perfil_gustos:
          (row.data.perfil_gustos as Record<string, unknown>) ?? {},
      };
    } else {
      profileFields = await perfTimed("profile.syncProfile", () =>
        syncProfileFromAuth(authUser),
      );
    }
    applyProfileFields(profileFields);

    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });

    const [userStats, badgeStats, friendsCountVal, notifs, ratings] =
      await Promise.all([
        perfTimed("profile.userStats", () => getUserStats(authUser.id)),
        perfTimed("profile.badgeStats", () =>
          getBadgeStats(authUser.id, { userCreatedAt: authUser.created_at }),
        ),
        perfTimed("profile.friendsCount", () => getFriendsCount(authUser.id)),
        perfTimed("profile.notifications", () =>
          getProfileNotificationCount(authUser.id),
        ),
        perfTimed("profile.ratings", () => getPendingRatingPlans(authUser.id)),
      ]);

    const nextBadges = getUserBadges(badgeStats);
    const friendsNotif = notifs.friendRequests + notifs.planInvites;

    setStats(userStats);
    setFriendsCount(friendsCountVal);
    setFriendsNotifCount(friendsNotif);
    setPlanRequests(notifs.planRequests);
    setPendingRatings(ratings);
    setBadges(nextBadges);
    setBadgesLoading(false);
    hasHydratedRef.current = true;

    const snap: ProfileUiSnapshot = {
      userId: authUser.id,
      nombre: profileFields.nombre,
      nombreUsuario: profileFields.nombre_usuario,
      aboutMe: profileFields.descripcion,
      avatarUrl: profileFields.avatar_url,
      age: calcAge(profileFields.fecha_nacimiento),
      genero: (profileFields.genero as Genero) || null,
      habitoBebida: parseHabitos(profileFields.habitos_consumo).bebida,
      habitoTabaco: parseHabitos(profileFields.habitos_consumo).tabaco,
      aficiones: profileFields.ambientes_preferidos?.length
        ? profileFields.ambientes_preferidos
        : profileFields.etiquetas,
      perfilGustos: profileFields.perfil_gustos,
      privacy: parsePrivacy(profileFields.perfil_gustos),
      stats: userStats,
      friendsCount: friendsCountVal,
      friendsNotifCount: friendsNotif,
      planRequests: notifs.planRequests,
      pendingRatings: ratings,
      badges: nextBadges,
    };
    cacheSet(
      screenCacheKey.profileUI(authUser.id),
      snap,
      ScreenCacheTTL.profileUI,
    );
    perfEnd("profile.total");
  };

  const uploadImage = async (uri: string) => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const fileName = `${user.id}/avatar.jpg`;
      const response = await fetch(uri);
      const blob = await response.blob();

      const base64data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const data = reader.result?.toString().split(",")[1];
          if (data) resolve(data);
          else reject(new Error("read_failed"));
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, decode(base64data), {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        Alert.alert(
          t("profile.error"),
          t("profile.uploadError") + ": " + uploadError.message,
        );
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(fileName);
      const urlWithTimestamp = `${publicUrl}?t=${Date.now()}`;

      await supabase
        .from("perfiles")
        .update({ avatar_url: urlWithTimestamp })
        .eq("id", user.id);
      void supabase.auth.updateUser({ data: { avatar_url: urlWithTimestamp } });
      setAvatarUrl(urlWithTimestamp);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("profile.uploadError");
      Alert.alert(t("profile.error"), msg);
    } finally {
      setLoading(false);
    }
  };

  const pickImage = async (useCamera: boolean) => {
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.4,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.4,
        });

    if (!result.canceled && result.assets[0]?.uri) {
      uploadImage(result.assets[0].uri);
    }
  };

  const showPhotoMenu = () => {
    Alert.alert(t("profile.photoTitle"), t("profile.photoChoice"), [
      { text: t("profile.camera"), onPress: () => pickImage(true) },
      { text: t("profile.gallery"), onPress: () => pickImage(false) },
      { text: t("profile.cancel"), style: "cancel" },
    ]);
  };

  const addAficion = (tag: string) => {
    if (aficiones.length >= PERSONALITY_MAX) {
      Alert.alert(t("profile.tagLimitTitle"), t("profile.tagLimit"));
      return;
    }
    if (!aficiones.includes(tag)) {
      const updated = [...aficiones, tag];
      setAficiones(updated);
      updateProfileData({ ambientes_preferidos: updated, etiquetas: updated });
    }
    setShowAficionModal(false);
  };

  const removeAficion = (tagToRemove: string) => {
    const updated = aficiones.filter((tag) => tag !== tagToRemove);
    setAficiones(updated);
    updateProfileData({ ambientes_preferidos: updated, etiquetas: updated });
  };

  const savePrivacy = async (next: ProfilePrivacy) => {
    setPrivacy(next);
    await updateProfileData({
      perfil_gustos: mergePerfilGustosPrivacy(perfilGustos, next),
    });
  };

  const saveHabitos = async (bebida: HabitoConsumo, tabaco: HabitoConsumo) => {
    setHabitoBebida(bebida);
    setHabitoTabaco(tabaco);
    await updateProfileData({ habitos_consumo: { bebida, tabaco } });
  };

  const updateProfileData = async (
    data: Record<string, unknown>,
  ): Promise<{ error: string | null }> => {
    if (!user?.id) return { error: null };
    return updateProfileFields(user.id, data);
  };

  const saveName = async () => {
    if (!user?.id) return;
    const trimmed = normalizeDisplayName(nombre);
    if (!isValidDisplayName(trimmed)) {
      Alert.alert(t("profile.error"), t("profile.displayNameHint"));
      return;
    }
    setNombre(trimmed);
    setIsEditing(false);
    const { error } = await updateDisplayName(user.id, trimmed);
    if (error) {
      Alert.alert(t("profile.error"), error);
      await fetchUserData();
    }
  };

  const saveUsername = async () => {
    if (!user?.id) return;
    const handle = normalizeUsername(usernameDraft);
    if (!isValidUsername(handle)) {
      Alert.alert(t("profile.error"), t("login.usernameInvalid"));
      return;
    }
    if (handle === normalizeUsername(nombreUsuario ?? "")) {
      setIsEditingUsername(false);
      return;
    }
    try {
      const taken = await isUsernameTaken(handle, user.id);
      if (taken) {
        Alert.alert(t("profile.error"), t("login.usernameTaken"));
        return;
      }
    } catch {
      Alert.alert(t("profile.error"), t("login.usernameCheckFailed"));
      return;
    }
    const prev = nombreUsuario;
    setNombreUsuario(handle);
    setIsEditingUsername(false);
    const { error, daysLeft } = await updateUsername(user.id, handle);
    if (error) {
      setNombreUsuario(prev);
      if (error === "username_cooldown") {
        const days =
          (daysLeft ?? (await getUsernameCooldownDaysLeft(user.id))) || 1;
        setUsernameCooldownDays(days);
        Alert.alert(
          t("profile.error"),
          t("profile.usernameCooldown", { days }),
        );
        return;
      }
      const isDuplicate =
        error === "username_taken" ||
        error.toLowerCase().includes("unique") ||
        error.toLowerCase().includes("duplicate");
      Alert.alert(
        t("profile.error"),
        isDuplicate ? t("login.usernameTaken") : t("login.usernameInvalid"),
      );
      await fetchUserData();
      return;
    }
    const days = await getUsernameCooldownDaysLeft(user.id);
    setUsernameCooldownDays(days);
  };

  const beginEditUsername = async () => {
    if (!user?.id) return;
    const days = await getUsernameCooldownDaysLeft(user.id);
    setUsernameCooldownDays(days);
    if (days > 0) {
      Alert.alert(t("profile.error"), t("profile.usernameCooldown", { days }));
      return;
    }
    setUsernameDraft(formatUsernameInput(nombreUsuario ?? ""));
    setIsEditingUsername(true);
  };

  const cancelEditUsername = () => {
    if (!isEditingUsername) return;
    setIsEditingUsername(false);
    setUsernameDraft(formatUsernameInput(nombreUsuario ?? ""));
  };

  const quickActions: QuickAction[] = [
    {
      key: "friends",
      icon: "people",
      labelKey: "profile.friends",
      route: "/friends",
      color: INK,
      bg: "#F1F5F9",
      badge: friendsNotifCount,
    },
    {
      key: "saved",
      icon: "heart",
      labelKey: "profile.saved",
      route: "/saved-plans",
      color: INK,
      bg: "#F1F5F9",
    },
  ];

  const displayName =
    nombre.trim() ||
    (user ? resolveDisplayName(user, t("profile.user")) : t("profile.user"));

  const confirmDeleteAccount = () => {
    Alert.alert(
      t("profile.deleteAccountTitle"),
      t("profile.deleteAccountMsg"),
      [
        { text: t("profile.cancel"), style: "cancel" },
        {
          text: t("profile.deleteAccountConfirm"),
          style: "destructive",
          onPress: handleDeleteAccount,
        },
      ],
    );
  };

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      const { error } = await deleteAccount();
      if (error) {
        Alert.alert(
          t("profile.error"),
          t("profile.deleteAccountError") + (error ? `\n${error}` : ""),
        );
        return;
      }
      router.replace("/login");
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <View style={styles.safe}>
      <LinearGradient
        colors={["#DBEAFE", "#EFF6FF", BG]}
        locations={[0, 0.35, 0.7]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safeInner} edges={["top", "left", "right"]}>
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.iconBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="chevron-back" size={22} color={INK} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>{t("profile.myProfile")}</Text>
          <TouchableOpacity
            onPress={() => router.push("/settings")}
            style={styles.iconBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="settings-outline" size={20} color={INK} />
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={scrollEventThrottle}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={cancelEditUsername}
        >
          <Pressable
            style={styles.scrollPressable}
            onPress={cancelEditUsername}
          >
            <View style={styles.heroCard}>
              <LinearGradient
                colors={["#FFFFFF", "#F8FBFF"]}
                style={styles.heroGlow}
              />
              <View style={styles.avatarBlock}>
                <TouchableOpacity onPress={showPhotoMenu} activeOpacity={0.9}>
                  <ProfileAvatar
                    uri={avatarUrl}
                    name={displayName}
                    size={104}
                    recyclingKey={user?.id}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={showPhotoMenu}
                  style={styles.cameraBtn}
                  activeOpacity={0.85}
                >
                  <Ionicons name="camera" size={15} color="#FFF" />
                </TouchableOpacity>
              </View>

              <View style={styles.nameBlock}>
                {isEditing ? (
                  <View style={styles.nameEditRow}>
                    <TextInput
                      style={styles.nameInput}
                      value={nombre}
                      onChangeText={(text) =>
                        setNombre(text.slice(0, DISPLAY_NAME_MAX_LENGTH))
                      }
                      autoFocus
                      maxLength={DISPLAY_NAME_MAX_LENGTH}
                      autoCapitalize="words"
                    />
                    <TouchableOpacity
                      onPress={saveName}
                      style={styles.nameSaveBtn}
                    >
                      <Ionicons name="checkmark" size={20} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.nameRow}
                    onPress={() => setIsEditing(true)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.nameSideSlot} />
                    <Text style={styles.displayName} numberOfLines={1}>
                      {displayName}
                    </Text>
                    <View style={styles.editNameChip}>
                      <Ionicons name="pencil" size={12} color={PRIMARY_DARK} />
                    </View>
                  </TouchableOpacity>
                )}
                {isEditingUsername ? (
                  <Pressable
                    style={styles.usernameEditRow}
                    onPress={(e) => e.stopPropagation()}
                  >
                    <Text style={styles.atPrefix}>@</Text>
                    <TextInput
                      style={styles.usernameInput}
                      value={usernameDraft}
                      onChangeText={(text) =>
                        setUsernameDraft(formatUsernameInput(text))
                      }
                      autoFocus
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      maxLength={USERNAME_MAX_LENGTH}
                    />
                    <TouchableOpacity
                      onPress={saveUsername}
                      style={styles.nameSaveBtn}
                    >
                      <Ionicons name="checkmark" size={18} color="#FFF" />
                    </TouchableOpacity>
                  </Pressable>
                ) : (
                  <TouchableOpacity
                    style={styles.usernameTap}
                    onPress={beginEditUsername}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.username} numberOfLines={1}>
                      @{nombreUsuario || "—"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.statsRow}>
                <TouchableOpacity
                  style={styles.statItem}
                  onPress={() => router.push("/my-plans")}
                  activeOpacity={0.8}
                >
                  <Text style={styles.statValue}>
                    {stats.numeroPlanesRealizados}
                  </Text>
                  <Text style={styles.statLabel}>{t("profile.plansDone")}</Text>
                </TouchableOpacity>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>
                    {formatRatingScore(stats.valoracionMedia)}
                  </Text>
                  <View style={styles.starsRow}>
                    {renderRatingStars(stats.valoracionMedia, 12)}
                  </View>
                  <Text style={styles.statMeta}>
                    {stats.numeroValoraciones}{" "}
                    {t(
                      stats.numeroValoraciones === 1
                        ? "profile.review"
                        : "profile.reviews",
                    )}
                  </Text>
                </View>
                <View style={styles.statDivider} />
                <TouchableOpacity
                  style={styles.statItem}
                  onPress={() =>
                    router.push({
                      pathname: "/friends",
                      params: { tab: "friends" },
                    })
                  }
                  onPressIn={() => warmFriendsAndSavedPlans(user?.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.statBadgeWrap}>
                    <Text style={styles.statValue}>{friendsCount}</Text>
                  </View>
                  <Text style={styles.statLabel}>
                    {t("profile.friendsLabel")}
                  </Text>
                </TouchableOpacity>
              </View>

              <ProfileReputationStats
                stats={stats}
                isSelf
                displayName={displayName}
                genero={genero}
              />
            </View>

            {pendingRatings.length > 0 ? (
              <>
                <Text style={styles.sectionHeading}>
                  {t("ratings.section")}
                </Text>
                <View style={styles.ratingsList}>
                  {pendingRatings.map((item) => {
                    const waiting = item.phase === "waiting";
                    const remaining = Math.max(0, item.unlockAt - nowTick);
                    const openCount = Math.max(
                      item.pendingCount,
                      waiting ? item.totalPeers : item.pendingCount,
                    );
                    return (
                      <TouchableOpacity
                        key={item.planId}
                        style={[
                          styles.ratingCard,
                          waiting
                            ? styles.ratingCardWait
                            : styles.ratingCardOpen,
                        ]}
                        activeOpacity={waiting ? 1 : 0.85}
                        disabled={waiting}
                        onPress={() =>
                          router.push({
                            pathname: "/rate-plan",
                            params: { planId: item.planId },
                          })
                        }
                      >
                        <View
                          style={[
                            styles.ratingIconWrap,
                            waiting
                              ? styles.ratingIconWait
                              : styles.ratingIconOpen,
                          ]}
                        >
                          <Ionicons
                            name={waiting ? "hourglass-outline" : "star"}
                            size={18}
                            color={waiting ? "#B45309" : "#FFF"}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={styles.ratingCardTitle}
                            numberOfLines={1}
                          >
                            {item.titulo}
                          </Text>
                          <Text style={styles.ratingCardSub}>
                            {waiting
                              ? t("ratings.unlockIn", {
                                  time: formatCountdown(remaining),
                                })
                              : item.pendingCount === 0
                                ? t("ratings.readyContinue")
                                : item.pendingCount === 1
                                  ? t("ratings.readyToRateOne")
                                  : t("ratings.readyToRate", {
                                      n: item.pendingCount,
                                    })}
                          </Text>
                          {!waiting && item.totalPeers > 0 ? (
                            <View style={styles.ratingMiniTrack}>
                              <View
                                style={[
                                  styles.ratingMiniFill,
                                  {
                                    width: `${Math.round(
                                      ((item.totalPeers - item.pendingCount) /
                                        item.totalPeers) *
                                        100,
                                    )}%`,
                                  },
                                ]}
                              />
                            </View>
                          ) : null}
                        </View>
                        {!waiting && openCount > 0 && (
                          <View style={styles.ratingReadyBadge}>
                            <Text style={styles.ratingReadyText}>
                              {item.pendingCount}
                            </Text>
                          </View>
                        )}
                        {!waiting && (
                          <Ionicons
                            name="chevron-forward"
                            size={16}
                            color="#CBD5E1"
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}

            <View style={styles.quickGrid}>
              {quickActions.map((action) => (
                <TouchableOpacity
                  key={action.key}
                  style={styles.quickTile}
                  onPressIn={() => warmFriendsAndSavedPlans(user?.id)}
                  onPress={() => {
                    if (action.key === "friends" && (action.badge ?? 0) > 0) {
                      router.push({
                        pathname: "/friends",
                        params: { tab: "requests" },
                      });
                    } else {
                      router.push(action.route as any);
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <View
                    style={[
                      styles.quickIconWrap,
                      { backgroundColor: action.bg },
                    ]}
                  >
                    <Ionicons
                      name={action.icon}
                      size={22}
                      color={action.color}
                    />
                    {(action.badge ?? 0) > 0 && (
                      <View style={styles.quickBadge}>
                        <Text style={styles.quickBadgeText}>
                          {(action.badge ?? 0) > 9 ? "9+" : action.badge}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.quickLabel} numberOfLines={2}>
                    {t(action.labelKey)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <ProfileDetailsSection
              age={age}
              genero={genero}
              habitoBebida={habitoBebida}
              habitoTabaco={habitoTabaco}
              privacy={privacy}
              onSaveHabitos={saveHabitos}
              onPrivacyChange={savePrivacy}
            />

            {/* About me */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{t("profile.aboutMe")}</Text>
                <Text style={styles.cardMeta}>{aboutMe.length}/400</Text>
              </View>
              {isEditingAboutMe ? (
                <View style={styles.aboutEdit}>
                  <TextInput
                    style={styles.aboutInput}
                    value={aboutMe}
                    onChangeText={(text) => {
                      if (text.length <= 400) setAboutMe(text);
                    }}
                    placeholder={t("profile.aboutPlaceholder")}
                    placeholderTextColor="#94A3B8"
                    multiline
                    autoFocus
                  />
                  <TouchableOpacity
                    style={styles.aboutSave}
                    onPress={async () => {
                      setIsEditingAboutMe(false);
                      await updateProfileData({ descripcion: aboutMe });
                    }}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={28}
                      color={PRIMARY_DARK}
                    />
                  </TouchableOpacity>
                </View>
              ) : (
                <Pressable
                  style={styles.aboutDisplay}
                  onPress={() => setIsEditingAboutMe(true)}
                >
                  <Text
                    style={aboutMe ? styles.aboutText : styles.aboutPlaceholder}
                  >
                    {aboutMe || t("profile.aboutEmpty")}
                  </Text>
                  <Ionicons name="create-outline" size={18} color="#94A3B8" />
                </Pressable>
              )}
            </View>

            {/* Personalidad */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{t("profile.personality")}</Text>
                <View style={styles.hobbyHeaderRight}>
                  <Text style={styles.cardMeta}>
                    {aficiones.length}/{PERSONALITY_MAX}
                  </Text>
                  <Switch
                    value={privacy.mostrar_aficiones}
                    onValueChange={(v) =>
                      savePrivacy({ ...privacy, mostrar_aficiones: v })
                    }
                    trackColor={{ false: "#E2E8F0", true: "#BFDBFE" }}
                    thumbColor={
                      privacy.mostrar_aficiones ? PRIMARY_DARK : "#94A3B8"
                    }
                  />
                </View>
              </View>
              <View style={styles.tagsWrap}>
                {!privacy.mostrar_aficiones ? (
                  <Text style={styles.personalityHidden}>
                    {t("profile.hidden")}
                  </Text>
                ) : (
                  <>
                    {aficiones.map((tag) => (
                      <View key={tag} style={styles.tagChip}>
                        <Text style={styles.tagText}>
                          {getPersonalityLabel(tag, genero, t)}
                        </Text>
                        <TouchableOpacity
                          onPress={() => removeAficion(tag)}
                          hitSlop={8}
                        >
                          <Ionicons
                            name="close"
                            size={14}
                            color={PRIMARY_DARK}
                          />
                        </TouchableOpacity>
                      </View>
                    ))}
                    {aficiones.length < PERSONALITY_MAX && (
                      <TouchableOpacity
                        style={styles.addTag}
                        onPress={() => setShowAficionModal(true)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="add" size={18} color={PRIMARY_DARK} />
                        <Text style={styles.addTagText}>
                          {t("profile.addPersonality")}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>
            </View>

            {/* Insignias */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{t("profile.badges")}</Text>
                <Text style={styles.cardMeta}>
                  {badges.filter((b) => b.unlocked).length}/{badges.length}
                </Text>
              </View>
              {badgesLoading ? (
                <ActivityIndicator
                  color={PRIMARY_DARK}
                  style={{ marginVertical: 24, alignSelf: "center" }}
                />
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  nestedScrollEnabled
                  contentContainerStyle={styles.badgeRow}
                >
                  {badges.map((badge) => (
                    <BadgeTile
                      key={badge.family.id}
                      badge={badge}
                      onPress={() => setSelectedBadge(badge)}
                    />
                  ))}
                </ScrollView>
              )}
            </View>

            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={async () => {
                await supabase.auth.signOut();
                router.replace("/login");
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="log-out-outline" size={20} color="#DC2626" />
              <Text style={styles.logoutText}>{t("profile.logout")}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.deleteAccountBtn}
              onPress={confirmDeleteAccount}
              disabled={deletingAccount}
              activeOpacity={0.85}
            >
              {deletingAccount ? (
                <ActivityIndicator color="#991B1B" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={20} color="#991B1B" />
                  <Text style={styles.deleteAccountText}>
                    {t("profile.deleteAccount")}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </Pressable>
        </ScrollView>

        <PersonalityPickerModal
          visible={showAficionModal}
          selected={aficiones}
          genero={genero}
          onAdd={addAficion}
          onClose={() => setShowAficionModal(false)}
        />
        <BadgeDetailModal
          badge={selectedBadge}
          visible={!!selectedBadge}
          onClose={() => setSelectedBadge(null)}
        />

        {loading && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={PRIMARY_DARK} />
              <Text style={styles.loadingText}>{t("profile.uploading")}</Text>
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}
