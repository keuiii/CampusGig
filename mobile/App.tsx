import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { ActivityIndicator, Alert, Animated, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StatusBar as NativeStatusBar, StyleSheet, Text, TextInput, View } from "react-native";

type Tab = "home" | "orders" | "messages" | "profile";
type Category = { id: string; name: string; icon: string; tint: string; ink: string; serviceCount: number };
type School = { id: string; name: string; shortName: string; city: string };
type ServicePackage = { id: string; tier: "BASIC" | "STANDARD" | "PREMIUM"; name: string; description: string; priceCentavos: number; deliveryDays: number; revisionLimit: number };
type Service = { id: string; title: string; description: string; category: string; providerId: string; provider: string; providerHasAvatar: boolean; providerAvatarVersion: number; schoolId: string; school: string; price: number; rating: number; delivery: string; packages: ServicePackage[]; coverMediaId?: string | null; portfolio?: { id: string; originalName: string; mimeType: string }[] };
type MobileOrder = { id: string; orderNumber: string; title: string; status: string; requirements: string; totalCentavos: number; currency: string; dueAt: string; createdAt: string; provider: { id: string; displayName: string }; package: ServicePackage };
type MobileNotification = { id: string; title: string; body: string; readAt: string | null; createdAt: string };
type AuthUser = { id: string; email: string; displayName: string; hasAvatar?: boolean; status: string; roles: string[] };
type AuthResponse = { accessToken: string; user: AuthUser };
type RegistrationResponse = { requiresVerification: true; email: string; developmentCode?: string };
type StudentProfile = { schoolId: string; program: string | null; yearLevel: number | null; bio: string | null; verificationStatus: string; school: School };
type VerificationRequest = { id: string; status: string; submittedAt: string; reviewedAt: string | null; rejectionReason: string | null };
type ProviderProfileData = { userId: string; headline: string; bio: string; skills: string[]; isAvailable: boolean };
const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
const TOKEN_KEY = "campusgig.accessToken";
const NIGHT_MODE_KEY = "campusgig.nightMode";

const defaultCategories: Category[] = [
  { id: "graphic-design", name: "Graphic Design", icon: "✦", tint: "#FFE6DD", ink: "#C85B39", serviceCount: 0 },
  { id: "tutoring", name: "Tutoring", icon: "A+", tint: "#EEE7FF", ink: "#6C51B7", serviceCount: 0 },
  { id: "programming", name: "Programming", icon: "</>", tint: "#E2EEFF", ink: "#376FB5", serviceCount: 0 },
  { id: "photography", name: "Photography", icon: "◉", tint: "#FFF0C9", ink: "#A8740D", serviceCount: 0 },
  { id: "video-editing", name: "Video Editing", icon: "▶", tint: "#DEF2E6", ink: "#287E56", serviceCount: 0 },
  { id: "writing", name: "Writing", icon: "Aa", tint: "#FDE6EF", ink: "#B44F78", serviceCount: 0 },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState(defaultCategories);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [orders, setOrders] = useState<MobileOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [loading, setLoading] = useState(Boolean(API_URL));
  const [refreshing, setRefreshing] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(Date.now());
  const [authChecking, setAuthChecking] = useState(true);
  const [nightMode, setNightMode] = useState(false);
  const screenMotion = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    AsyncStorage.getItem(NIGHT_MODE_KEY).then((value) => setNightMode(value === "true")).catch(() => undefined);
    AsyncStorage.getItem(TOKEN_KEY).then(async (token) => {
      if (!token || !API_URL) return;
      const response = await fetch(`${API_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) setAuthUser(await response.json());
      else await AsyncStorage.removeItem(TOKEN_KEY);
    }).catch(() => AsyncStorage.removeItem(TOKEN_KEY)).finally(() => setAuthChecking(false));
  }, []);

  async function toggleNightMode(value: boolean) {
    setNightMode(value);
    await AsyncStorage.setItem(NIGHT_MODE_KEY, String(value));
  }

  async function authenticate(path: string, values: Record<string, unknown>) {
    if (!API_URL) throw new Error("The CampusGig API address is not configured.");
    const response = await fetch(`${API_URL}/api/v1/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message ?? "Unable to continue. Please check your details.");
    if (payload?.accessToken) {
      const session = payload as AuthResponse;
      await AsyncStorage.setItem(TOKEN_KEY, session.accessToken);
      setAuthUser(session.user);
    }
    return payload;
  }

  async function logout() {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setAuthUser(null);
    setTab("home");
  }

  async function loadMarketplace(showRefresh = false) {
    if (!API_URL) return;
    if (showRefresh) setRefreshing(true);
    const loadingFallback = setTimeout(() => setLoading(false), 2500);
    await Promise.allSettled([
      fetch(`${API_URL}/api/v1/categories`).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${API_URL}/api/v1/schools`).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${API_URL}/api/v1/services`).then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([categoryResult, schoolResult, serviceResult]) => {
      if (categoryResult.status === "fulfilled" && categoryResult.value.data?.length) {
        setCategories(categoryResult.value.data.map((category: Category) => ({ ...category, tint: defaultCategories.find((item) => item.id === category.id)?.tint ?? "#DEF2E6", ink: defaultCategories.find((item) => item.id === category.id)?.ink ?? "#287E56" })));
      }
      if (schoolResult.status === "fulfilled") setSchools(schoolResult.value.data ?? []);
      if (serviceResult.status === "fulfilled") setServices(serviceResult.value.data ?? []);
    }).finally(() => { clearTimeout(loadingFallback); setLoading(false); setRefreshing(false); });
  }

  useEffect(() => {
    void loadMarketplace();
  }, []);

  async function loadOrders() {
    if (!authUser || !API_URL) return;
    setOrdersLoading(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/orders?scope=client`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) setOrders((await response.json()).data ?? []);
    } finally { setOrdersLoading(false); }
  }

  useEffect(() => { if (authUser) void loadOrders(); }, [authUser?.id]);

  function changeTab(next: Tab) {
    if (next === "orders") void loadOrders();
    if (next === tab) return;
    screenMotion.setValue(0);
    setTab(next);
    Animated.spring(screenMotion, { toValue: 1, damping: 18, stiffness: 190, mass: .75, useNativeDriver: true }).start();
  }

  const filteredServices = services.filter((service) => `${service.title} ${service.provider} ${service.category}`.toLowerCase().includes(query.toLowerCase()) && (!selectedCategory || service.category === selectedCategory) && (!selectedSchoolId || service.schoolId === selectedSchoolId));
  if (authChecking) return <SafeAreaView style={styles.authSafe}><StatusBar style="dark"/><ActivityIndicator size="large" color={green}/><Text style={styles.authLoading}>Opening CampusGig</Text></SafeAreaView>;
  if (!authUser) return <AuthScreen nightMode={nightMode} onNightModeChange={toggleNightMode} onAuthenticate={authenticate}/>;
  return <SafeAreaView style={[styles.safe,nightMode&&darkStyles.surface]}><StatusBar style={nightMode?"light":"dark"}/><View style={[styles.app,nightMode&&darkStyles.surface]}><Animated.View style={[styles.animatedScreen,{opacity:screenMotion,transform:[{translateY:screenMotion.interpolate({inputRange:[0,1],outputRange:[8,0]})}]}]}>
    {tab === "home" && (
      <Home nightMode={nightMode} user={authUser} avatarVersion={avatarVersion} query={query} setQuery={setQuery} categories={categories} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} schools={schools} selectedSchoolId={selectedSchoolId} setSelectedSchoolId={setSelectedSchoolId} services={filteredServices} loading={loading} refreshing={refreshing} onRefresh={() => loadMarketplace(true)} onOpenService={setSelectedService} onOpenProfile={() => changeTab("profile")}/>
    )}
    {tab === "orders" && <OrdersScreen nightMode={nightMode} orders={orders} loading={ordersLoading} onRefresh={loadOrders} onBrowse={() => changeTab("home")}/>}
    {tab === "messages" && <EmptyScreen nightMode={nightMode} eyebrow="CONVERSATIONS" title="Messages" icon="◌" message="Order conversations will appear here after a booking is created."/>}
    {tab === "profile" && <Profile nightMode={nightMode} onNightModeChange={toggleNightMode} user={authUser} schools={schools} avatarVersion={avatarVersion} onAvatarChanged={() => { setAuthUser((current) => current ? { ...current, hasAvatar: true } : current); setAvatarVersion(Date.now()); }} onLogout={logout}/>}</Animated.View>{!selectedService&&<BottomNav nightMode={nightMode} tab={tab} setTab={changeTab}/>}<ServiceBookingModal service={selectedService} onClose={() => setSelectedService(null)} onCreated={async () => { setSelectedService(null); await loadOrders(); changeTab("orders"); }}/>
  </View></SafeAreaView>;
}

function AuthScreen({ nightMode, onNightModeChange, onAuthenticate }: { nightMode: boolean; onNightModeChange: (value: boolean) => void; onAuthenticate: (path: string, values: Record<string, unknown>) => Promise<any> }) {
  const [mode, setMode] = useState<"login" | "register" | "verify" | "forgot" | "reset">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [isStudent, setIsStudent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tabTrackWidth, setTabTrackWidth] = useState(0);
  const sliderX = useRef(new Animated.Value(0)).current;
  const formMotion = useRef(new Animated.Value(1)).current;
  const formReady = mode === "verify" ? code.length === 6 : mode === "forgot" ? Boolean(email.trim()) : mode === "reset" ? code.length === 6 && password.length >= 8 : Boolean(email.trim() && password.length >= 8 && (mode === "login" || displayName.trim().length >= 2));

  function switchMode(nextMode: "login" | "register" | "verify" | "forgot" | "reset") {
    if (nextMode === mode) return;
    const segmentWidth = Math.max(0, (tabTrackWidth - 8) / 2);
    Animated.timing(sliderX, { toValue: nextMode === "register" ? segmentWidth : 0, duration: 240, useNativeDriver: true }).start();
    Animated.timing(formMotion, { toValue: 0, duration: 110, useNativeDriver: true }).start(() => {
      setMode(nextMode);
      setPassword("");
      setCode("");
      setShowPassword(false);
      formMotion.setValue(0);
      Animated.spring(formMotion, { toValue: 1, damping: 18, stiffness: 190, mass: .65, useNativeDriver: true }).start();
    });
  }

  async function submit() {
    if (!formReady) return Alert.alert("Complete your details", "Please fill in every required field.");
    setSubmitting(true);
    try {
      if (mode === "login") await onAuthenticate("login", { email: email.trim(), password });
      else if (mode === "register") { const result = await onAuthenticate("register", { email: email.trim(), password, displayName: displayName.trim(), isStudent }) as RegistrationResponse; switchMode("verify"); if (result.developmentCode) { setTimeout(() => setCode(result.developmentCode!), 150); Alert.alert("Development verification", "Your test code has been filled in automatically."); } }
      else if (mode === "verify") await onAuthenticate("verify-email", { email: email.trim(), code });
      else if (mode === "forgot") { const result = await onAuthenticate("forgot-password", { email: email.trim() }); switchMode("reset"); if (result.developmentCode) setTimeout(() => setCode(result.developmentCode), 150); Alert.alert("Reset code requested", result.developmentCode ? "Your development code has been filled in." : result.message); }
      else { const result = await onAuthenticate("reset-password", { email: email.trim(), code, password }); Alert.alert("Password updated", result.message); switchMode("login"); }
    }
    catch (error) { Alert.alert("Unable to continue", error instanceof Error ? error.message : "Please try again."); }
    finally { setSubmitting(false); }
  }

  return <SafeAreaView style={[styles.authSafe,nightMode&&darkStyles.surface]}>
    <StatusBar style={nightMode?"light":"dark"}/>
    <View style={[styles.authBlobOne,nightMode&&darkStyles.authBlob]}/><View style={[styles.authBlobTwo,nightMode&&darkStyles.authBlob]}/>
    <View style={styles.authThemeToggle}><ThemeToggle value={nightMode} onChange={onNightModeChange}/></View>
    <KeyboardAvoidingView style={styles.authKeyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.authContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.authIdentity}><View style={styles.authMark}><Text style={styles.authMarkText}>C</Text></View><Text style={[styles.authBrand,nightMode&&darkStyles.primaryText]}>Campus<Text style={styles.brandAccent}>Gig</Text></Text></View>
        <View style={styles.authIntro}><Text style={[styles.authTitle,nightMode&&darkStyles.primaryText]}>{mode === "verify" ? "Verify your email" : mode === "forgot" ? "Forgot password?" : mode === "reset" ? "Create a new password" : "Welcome to CampusGig"}</Text><Text style={[styles.authSubtitle,nightMode&&darkStyles.mutedText]}>{mode === "verify" ? `Enter the code sent to ${email}.` : mode === "forgot" ? "We’ll send a reset code to your account email." : mode === "reset" ? "Enter your code and choose a secure new password." : "Your trusted marketplace for verified student skills and services."}</Text></View>
        <View style={[styles.authCard,nightMode&&darkStyles.card]}>
          {(mode === "login" || mode === "register") && <View style={[styles.authTabs,nightMode&&darkStyles.input]} onLayout={(event) => setTabTrackWidth(event.nativeEvent.layout.width)}>
            {tabTrackWidth > 0 && <Animated.View pointerEvents="none" style={[styles.authTabSlider,nightMode&&darkStyles.card, { width: (tabTrackWidth - 8) / 2, transform: [{ translateX: sliderX }] }]}/>}
            <Pressable onPress={() => switchMode("login")} style={({pressed})=>[styles.authTab,pressed&&styles.pressed]}><Text style={[styles.authTabText, mode === "login" && styles.authTabTextActive]}>Log in</Text></Pressable>
            <Pressable onPress={() => switchMode("register")} style={({pressed})=>[styles.authTab,pressed&&styles.pressed]}><Text style={[styles.authTabText, mode === "register" && styles.authTabTextActive]}>Sign up</Text></Pressable>
          </View>}
          <Animated.View style={{ opacity: formMotion, transform: [{ translateY: formMotion.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
            {mode === "register" && <><Text style={styles.inputLabel}>FULL NAME</Text><View style={[styles.inputShell,nightMode&&darkStyles.input]}><Text style={styles.inputGlyph}>◎</Text><TextInput value={displayName} onChangeText={setDisplayName} placeholder="Your full name" placeholderTextColor="#929A96" style={[styles.authInput,nightMode&&darkStyles.primaryText]} autoCapitalize="words" returnKeyType="next"/></View></>}
            {mode !== "verify" && <><Text style={styles.inputLabel}>EMAIL ADDRESS</Text><View style={[styles.inputShell,nightMode&&darkStyles.input]}><Text style={styles.inputGlyph}>@</Text><TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#929A96" style={[styles.authInput,nightMode&&darkStyles.primaryText]} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" returnKeyType="next"/></View></>}
            {mode === "register" && <Pressable onPress={() => setIsStudent((value) => !value)} style={({pressed})=>[styles.studentChoice,nightMode&&darkStyles.input,isStudent&&styles.studentChoiceActive,pressed&&styles.pressed]}><View style={[styles.studentCheckbox,isStudent&&styles.studentCheckboxActive]}><Text style={styles.studentCheckboxText}>{isStudent ? "✓" : ""}</Text></View><View style={styles.studentChoiceCopy}><Text style={[styles.studentChoiceTitle,nightMode&&darkStyles.primaryText]}>I’m currently a student</Text><Text style={[styles.studentChoiceBody,nightMode&&darkStyles.mutedText]}>Select for school verification and future provider access.</Text></View></Pressable>}
            {(mode === "verify" || mode === "reset") && <><Text style={styles.inputLabel}>SIX-DIGIT CODE</Text><View style={[styles.inputShell,nightMode&&darkStyles.input]}><Text style={styles.inputGlyph}>#</Text><TextInput value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" placeholderTextColor="#929A96" style={[styles.authInput,nightMode&&darkStyles.primaryText]} keyboardType="number-pad" maxLength={6}/></View></>}
            {(mode === "login" || mode === "register" || mode === "reset") && <><Text style={styles.inputLabel}>{mode === "reset" ? "NEW PASSWORD" : "PASSWORD"}</Text><View style={[styles.inputShell,nightMode&&darkStyles.input]}><Text style={styles.inputGlyph}>◇</Text><TextInput value={password} onChangeText={setPassword} placeholder="At least 8 characters" placeholderTextColor="#929A96" style={[styles.authInput,nightMode&&darkStyles.primaryText]} secureTextEntry={!showPassword} autoCapitalize="none" returnKeyType="done" onSubmitEditing={formReady ? submit : undefined}/><Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10}><Text style={styles.passwordToggle}>{showPassword ? "HIDE" : "SHOW"}</Text></Pressable></View><View style={styles.passwordHint}><Text style={[styles.hintCheck, password.length >= 8 && styles.hintCheckReady]}>{password.length >= 8 ? "✓" : "○"}</Text><Text style={[styles.hintText,nightMode&&darkStyles.mutedText]}>Minimum 8 characters</Text></View></>}
            <Pressable disabled={submitting || !formReady} onPress={submit} style={({pressed})=>[styles.authButton,(submitting || !formReady)&&styles.authButtonDisabled,pressed&&styles.pressed]}>{submitting ? <ActivityIndicator color="#FFF"/> : <><Text style={styles.authButtonText}>{mode === "login" ? "Log in" : mode === "register" ? `Create ${isStudent ? "student" : "client"} account` : mode === "verify" ? "Verify email" : mode === "forgot" ? "Send reset code" : "Update password"}</Text><Text style={styles.authButtonArrow}>→</Text></>}</Pressable>
            {mode === "login" && <Pressable onPress={() => switchMode("forgot")}><Text style={styles.authTextLink}>Forgot password?</Text></Pressable>}
            {(mode === "verify" || mode === "forgot" || mode === "reset") && <Pressable onPress={() => switchMode("login")}><Text style={styles.authTextLink}>← Back to login</Text></Pressable>}
            <View style={[styles.authTrust,nightMode&&darkStyles.rolePill]}><Text style={styles.authTrustIcon}>✓</Text><Text style={[styles.authTrustText,nightMode&&darkStyles.mutedText]}>Personal email is accepted. School email is optional and account details stay private.</Text></View>
          </Animated.View>
        </View>
        <Text style={[styles.authNote,nightMode&&darkStyles.mutedText]}>By continuing, you agree to the CampusGig community guidelines.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function Home({ nightMode, user, avatarVersion, query, setQuery, categories, selectedCategory, setSelectedCategory, schools, selectedSchoolId, setSelectedSchoolId, services, loading, refreshing, onRefresh, onOpenService, onOpenProfile }: { nightMode: boolean; user: AuthUser; avatarVersion: number; query: string; setQuery: (value: string) => void; categories: Category[]; selectedCategory: string | null; setSelectedCategory: (value: string | null) => void; schools: School[]; selectedSchoolId: string; setSelectedSchoolId: (value: string) => void; services: Service[]; loading: boolean; refreshing: boolean; onRefresh: () => void; onOpenService: (service: Service) => void; onOpenProfile: () => void }) {
  const [notifications, setNotifications] = useState<MobileNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  async function loadNotifications(show = false) {
    const token = await AsyncStorage.getItem(TOKEN_KEY); if (!token) return;
    const response = await fetch(`${API_URL}/api/v1/notifications`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const payload = await response.json(); const items = (payload.data ?? []) as MobileNotification[]; setNotifications(items); setUnreadCount(payload.unreadCount ?? 0);
    if (show) {
      Alert.alert("Notifications", items.length ? items.slice(0,5).map((item) => `${item.readAt ? "" : "● "}${item.title}\n${item.body}`).join("\n\n") : "You have no notifications yet.");
      const unread = items.filter((item) => !item.readAt); await Promise.allSettled(unread.map((item) => fetch(`${API_URL}/api/v1/notifications/${item.id}/read`, { method:"PATCH", headers:{ Authorization:`Bearer ${token}` } }))); setNotifications((current)=>current.map((item)=>({...item,readAt:item.readAt??new Date().toISOString()}))); setUnreadCount(0);
    }
  }
  useEffect(() => { void loadNotifications(); }, [user.id]);
  return <ScrollView style={[styles.screen,nightMode&&darkStyles.surface]} contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[green]} tintColor={nightMode?"#D9F36A":green}/> }>
    <View style={styles.header}><View><Text style={[styles.hello,nightMode&&darkStyles.mutedText]}>WELCOME TO</Text><Text style={[styles.brand,nightMode&&darkStyles.primaryText]}>Campus<Text style={styles.brandAccent}>Gig</Text></Text></View><View style={styles.headerActions}><Pressable onPress={() => void loadNotifications(true)} style={({pressed}) => [styles.roundButton,nightMode&&darkStyles.outline, pressed && styles.pressed]}><Text style={styles.bell}>🔔</Text>{unreadCount>0&&<View style={styles.mobileNotificationBadge}><Text style={styles.mobileNotificationBadgeText}>{unreadCount>9?"9+":unreadCount}</Text></View>}</Pressable><Pressable onPress={onOpenProfile} style={({pressed}) => [styles.account, pressed && styles.pressed]}>{user.hasAvatar ? <Image source={{ uri: `${API_URL}/api/v1/profile/avatar/${user.id}?v=${avatarVersion}` }} style={styles.accountImage}/> : <Text style={styles.accountText}>{user.displayName.charAt(0).toUpperCase()}</Text>}</Pressable></View></View>
    <View style={[styles.hero,nightMode&&darkStyles.card]}><View style={styles.heroCircleOne}/><View style={styles.heroCircleTwo}/><Text style={styles.heroKicker}>STUDENT SKILLS, REAL OPPORTUNITIES</Text><Text style={[styles.heroTitle,nightMode&&darkStyles.primaryText]}>What do you need help with today?</Text><Text style={[styles.heroBody,nightMode&&darkStyles.mutedText]}>Find trusted services from verified students in your campus community.</Text><View style={[styles.search,nightMode&&darkStyles.input]}><Text style={styles.searchIcon}>⌕</Text><TextInput value={query} onChangeText={setQuery} placeholder="Search student services" placeholderTextColor="#8C9690" style={[styles.searchInput,nightMode&&darkStyles.primaryText]}/></View></View>
    <View style={styles.schoolSection}><Text style={styles.schoolLabel}>PREFERRED SCHOOL</Text><Text style={[styles.schoolHelp,nightMode&&darkStyles.mutedText]}>Show providers from a particular school</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.schoolChips}><Pressable onPress={() => setSelectedSchoolId("")} style={({pressed})=>[styles.schoolChip,nightMode&&darkStyles.card,!selectedSchoolId&&styles.schoolChipActive,pressed&&styles.pressed]}><Text style={[styles.schoolChipText,nightMode&&darkStyles.primaryText,!selectedSchoolId&&styles.schoolChipTextActive]}>All schools</Text></Pressable>{schools.map((school) => <Pressable key={school.id} onPress={() => setSelectedSchoolId(school.id)} style={({pressed})=>[styles.schoolChip,nightMode&&darkStyles.card,selectedSchoolId===school.id&&styles.schoolChipActive,pressed&&styles.pressed]}><Text style={[styles.schoolChipText,nightMode&&darkStyles.primaryText,selectedSchoolId===school.id&&styles.schoolChipTextActive]}>{school.shortName || school.name}</Text></Pressable>)}</ScrollView></View>
    <View style={styles.sectionTitleRow}><View><Text style={styles.eyebrow}>EXPLORE</Text><Text style={[styles.sectionTitle,nightMode&&darkStyles.primaryText]}>Browse categories</Text></View>{selectedCategory && <Pressable onPress={() => setSelectedCategory(null)}><Text style={styles.link}>Clear</Text></Pressable>}</View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>{categories.map((category) => <Pressable key={category.id} onPress={() => setSelectedCategory(selectedCategory === category.name ? null : category.name)} style={({pressed})=>[styles.category,nightMode&&darkStyles.card,selectedCategory===category.name&&styles.categorySelected,pressed&&styles.pressed]}><View style={[styles.categoryIcon,{backgroundColor:category.tint}]}><Text style={[styles.categoryIconText,{color:category.ink}]}>{category.icon}</Text></View><Text style={[styles.categoryName,nightMode&&darkStyles.primaryText]}>{category.name}</Text><Text style={[styles.categoryCount,nightMode&&darkStyles.mutedText]}>{category.serviceCount} services</Text></Pressable>)}</ScrollView>
    <View style={styles.sectionTitleRow}><View><Text style={styles.eyebrow}>MARKETPLACE</Text><Text style={[styles.sectionTitle,nightMode&&darkStyles.primaryText]}>{selectedCategory ?? "Available services"}</Text></View></View>
    {loading ? <View style={[styles.emptyCard,nightMode&&darkStyles.card]}><ActivityIndicator color="#0F6B4F"/><Text style={[styles.emptyTitle,nightMode&&darkStyles.primaryText]}>Connecting to CampusGig</Text><Text style={[styles.emptyBody,nightMode&&darkStyles.mutedText]}>Loading real marketplace data.</Text></View> : services.length === 0 ? <View style={[styles.emptyCard,nightMode&&darkStyles.card]}><View style={styles.emptyIcon}><Text style={styles.emptyIconText}>◇</Text></View><Text style={[styles.emptyTitle,nightMode&&darkStyles.primaryText]}>No services published yet</Text><Text style={[styles.emptyBody,nightMode&&darkStyles.mutedText]}>Verified provider services will appear here automatically.</Text><Pressable onPress={onOpenProfile} style={({pressed}) => [styles.providerButton, pressed && styles.pressed]}><Text style={styles.providerButtonText}>Become a provider</Text><Text style={styles.providerArrow}>→</Text></Pressable></View> : services.map((service) => <Pressable onPress={() => onOpenService(service)} key={service.id} style={({pressed})=>[styles.serviceCard,nightMode&&darkStyles.card,pressed&&styles.pressed]}>{service.coverMediaId ? <Image source={{uri:`${API_URL}/api/v1/services/${service.id}/media/${service.coverMediaId}`}} style={styles.serviceCover} resizeMode="cover"/> : <View style={styles.serviceCoverFallback}><Text style={styles.serviceCoverFallbackText}>◇</Text></View>}<View style={styles.serviceCardBody}><Text style={styles.serviceCategory}>{service.category}</Text><Text style={[styles.serviceTitle,nightMode&&darkStyles.primaryText]}>{service.title}</Text><View style={styles.serviceProviderRow}>{service.providerHasAvatar?<Image source={{uri:`${API_URL}/api/v1/profile/avatar/${service.providerId}?v=${service.providerAvatarVersion}`}} style={styles.serviceProviderAvatar}/>:<View style={styles.serviceProviderFallback}><Text style={styles.serviceProviderFallbackText}>{service.provider.charAt(0).toUpperCase()}</Text></View>}<Text style={[styles.serviceMeta,nightMode&&darkStyles.mutedText]}>{service.provider} · {service.school}</Text></View><View style={[styles.serviceFooter,nightMode&&darkStyles.outline]}><Text style={styles.serviceRating}>★ {service.rating}</Text><Text style={[styles.servicePrice,nightMode&&darkStyles.primaryText]}>From ₱{service.price}</Text></View></View></Pressable>)}
    <View style={[styles.safetyCard,nightMode&&darkStyles.card]}><View style={styles.safetyIcon}><Text>✓</Text></View><View style={styles.safetyCopy}><Text style={styles.safetyTitle}>Built for campus trust</Text><Text style={[styles.safetyBody,nightMode&&darkStyles.mutedText]}>Student verification, order-based messaging, and clear project tracking.</Text></View></View>
  </ScrollView>;
}

function ServiceBookingModal({ service, onClose, onCreated }: { service: Service | null; onClose: () => void; onCreated: () => Promise<void> }) {
  const [packageId, setPackageId] = useState("");
  const [requirements, setRequirements] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { setPackageId(service?.packages[0]?.id ?? ""); setRequirements(""); }, [service?.id]);
  const selectedPackage = service?.packages.find((item) => item.id === packageId) ?? service?.packages[0];

  async function createOrder() {
    if (!service || !selectedPackage) return;
    if (requirements.trim().length < 10) return Alert.alert("Add your requirements", "Tell the provider what you need using at least 10 characters.");
    setSubmitting(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/orders`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ serviceId: service.id, servicePackageId: selectedPackage.id, requirements: requirements.trim() }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join("\n") : payload?.message ?? "Unable to create your order.");
      Alert.alert("Request sent", `${payload.data.orderNumber} was created. ${payload.message}`);
      await onCreated();
    } catch (error) { Alert.alert("Booking failed", error instanceof Error ? error.message : "Please try again."); }
    finally { setSubmitting(false); }
  }

  return <Modal visible={Boolean(service)} animationType="slide" transparent onRequestClose={onClose}><KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}><View style={styles.bookingSheet}><View style={styles.sheetHandle}/><View style={styles.bookingHeader}><View style={styles.bookingHeaderCopy}><Text style={styles.serviceCategory}>{service?.category}</Text><Text style={styles.bookingTitle}>{service?.title}</Text><Text style={styles.serviceMeta}>{service?.provider} · {service?.school}</Text></View><Pressable onPress={onClose} style={styles.closeButton}><Text style={styles.closeButtonText}>×</Text></Pressable></View><ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.bookingContent}>{service?.coverMediaId ? <Image source={{uri:`${API_URL}/api/v1/services/${service.id}/media/${service.coverMediaId}`}} style={styles.bookingCover}/> : null}<Text style={styles.bookingDescription}>{service?.description}</Text><Text style={styles.groupLabel}>CHOOSE A PACKAGE</Text>{service?.packages.map((item) => <Pressable key={item.id} onPress={() => setPackageId(item.id)} style={[styles.packageChoice,packageId === item.id&&styles.packageChoiceActive]}><View style={styles.packageChoiceTop}><View><Text style={styles.packageTier}>{item.tier}</Text><Text style={styles.packageName}>{item.name}</Text></View><Text style={styles.packagePrice}>₱{(item.priceCentavos/100).toLocaleString()}</Text></View><Text style={styles.packageDescription}>{item.description}</Text><Text style={styles.packageMeta}>{item.deliveryDays} day delivery · {item.revisionLimit} revision{item.revisionLimit === 1 ? "" : "s"}</Text></Pressable>)}<Text style={styles.groupLabel}>PROJECT REQUIREMENTS</Text><TextInput value={requirements} onChangeText={setRequirements} multiline maxLength={3000} placeholder="Describe exactly what you need, preferred style, dimensions, deadline details, and references…" placeholderTextColor="#929A96" style={styles.requirementsInput}/><Text style={styles.requirementsCount}>{requirements.trim().length}/3000 · minimum 10 characters</Text><View style={styles.bookingSummary}><View><Text style={styles.summaryLabel}>TOTAL FOR THIS REQUEST</Text><Text style={styles.summaryHelp}>Payment will be connected through PayMongo later.</Text></View><Text style={styles.summaryPrice}>₱{((selectedPackage?.priceCentavos ?? 0)/100).toLocaleString()}</Text></View><Pressable disabled={submitting || !selectedPackage || requirements.trim().length < 10} onPress={createOrder} style={({pressed})=>[styles.authButton,(submitting || !selectedPackage || requirements.trim().length < 10)&&styles.authButtonDisabled,pressed&&styles.pressed]}>{submitting ? <ActivityIndicator color="#FFF"/> : <><Text style={styles.authButtonText}>Send service request</Text><Text style={styles.authButtonArrow}>→</Text></>}</Pressable><Text style={styles.providerNotice}>The provider will receive an in-app notification immediately.</Text></ScrollView></View></KeyboardAvoidingView></Modal>;
}

function OrdersScreen({ nightMode, orders, loading, onRefresh, onBrowse }: { nightMode: boolean; orders: MobileOrder[]; loading: boolean; onRefresh: () => Promise<void>; onBrowse: () => void }) {
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() { setRefreshing(true); await onRefresh(); setRefreshing(false); }
  return <ScrollView style={[styles.screen,nightMode&&darkStyles.surface]} contentContainerStyle={styles.standardContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[green]} tintColor={nightMode?"#D9F36A":green}/>}><Text style={styles.eyebrow}>MY PROJECTS</Text><Text style={[styles.pageTitle,nightMode&&darkStyles.primaryText]}>Orders</Text><Text style={[styles.ordersIntro,nightMode&&darkStyles.mutedText]}>Track every service request from confirmation to completion.</Text>{loading&&!orders.length ? <ActivityIndicator color={green} style={{marginTop:45}}/> : orders.length ? orders.map((order) => <View key={order.id} style={[styles.orderCard,nightMode&&darkStyles.card]}><View style={styles.orderTop}><Text style={[styles.orderNumber,nightMode&&darkStyles.mutedText]}>{order.orderNumber}</Text><View style={styles.orderStatus}><Text style={styles.orderStatusText}>{order.status.replaceAll("_"," ")}</Text></View></View><Text style={[styles.orderTitle,nightMode&&darkStyles.primaryText]}>{order.title}</Text><Text style={[styles.orderProvider,nightMode&&darkStyles.mutedText]}>Provider · {order.provider.displayName}</Text><View style={[styles.orderMetaRow,nightMode&&darkStyles.outline]}><View><Text style={styles.orderMetaLabel}>PACKAGE</Text><Text style={[styles.orderMetaValue,nightMode&&darkStyles.primaryText]}>{order.package.name}</Text></View><View><Text style={styles.orderMetaLabel}>TOTAL</Text><Text style={[styles.orderMetaValue,nightMode&&darkStyles.primaryText]}>₱{(order.totalCentavos/100).toLocaleString()}</Text></View><View><Text style={styles.orderMetaLabel}>DUE</Text><Text style={[styles.orderMetaValue,nightMode&&darkStyles.primaryText]}>{new Date(order.dueAt).toLocaleDateString()}</Text></View></View></View>) : <View style={styles.largeEmpty}><View style={styles.largeEmptyIcon}><Text style={styles.largeEmptyIconText}>◇</Text></View><Text style={[styles.emptyTitle,nightMode&&darkStyles.primaryText]}>No orders yet</Text><Text style={[styles.emptyBody,nightMode&&darkStyles.mutedText]}>Choose a published student service and send your first project request.</Text><Pressable style={styles.primaryButton} onPress={onBrowse}><Text style={styles.primaryButtonText}>Browse services</Text></Pressable></View>}</ScrollView>;
}

function EmptyScreen({ nightMode, eyebrow, title, icon, message, action, onAction }: { nightMode: boolean; eyebrow: string; title: string; icon: string; message: string; action?: string; onAction?: () => void }) {
  return <ScrollView style={[styles.screen,nightMode&&darkStyles.surface]} contentContainerStyle={styles.standardContent}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={[styles.pageTitle,nightMode&&darkStyles.primaryText]}>{title}</Text><View style={styles.largeEmpty}><View style={styles.largeEmptyIcon}><Text style={styles.largeEmptyIconText}>{icon}</Text></View><Text style={[styles.emptyTitle,nightMode&&darkStyles.primaryText]}>Nothing here yet</Text><Text style={[styles.emptyBody,nightMode&&darkStyles.mutedText]}>{message}</Text>{action && <Pressable style={styles.primaryButton} onPress={onAction}><Text style={styles.primaryButtonText}>{action}</Text></Pressable>}</View></ScrollView>;
}

function AccountSettings({ user, nightMode }: { user: AuthUser; nightMode: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function changePassword() {
    if (newPassword.length < 8) return Alert.alert("Password is too short", "Use at least 8 characters for your new password.");
    if (newPassword !== confirmPassword) return Alert.alert("Passwords do not match", "Enter the same new password in both fields.");
    setSaving(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/auth/change-password`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ currentPassword, newPassword }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(Array.isArray(result?.message) ? result.message.join("\n") : result?.message ?? "Unable to update your password.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      Alert.alert("Password updated", "Use your new password the next time you sign in.");
    } catch (error) { Alert.alert("Could not update password", error instanceof Error ? error.message : "Please try again."); }
    finally { setSaving(false); }
  }

  return <View style={[styles.expandPanel,nightMode&&darkStyles.card]}>
    <Text style={[styles.formTitle,nightMode&&darkStyles.primaryText]}>Account and security</Text><Text style={[styles.formHelp,nightMode&&darkStyles.mutedText]}>Your account can hold more than one role as you grow on CampusGig.</Text>
    <View style={[styles.accountDetail,nightMode&&darkStyles.outline]}><Text style={[styles.accountDetailLabel,nightMode&&darkStyles.mutedText]}>EMAIL</Text><Text style={[styles.accountDetailValue,nightMode&&darkStyles.primaryText]}>{user.email}</Text></View>
    <View style={[styles.accountDetail,nightMode&&darkStyles.outline]}><Text style={[styles.accountDetailLabel,nightMode&&darkStyles.mutedText]}>ACTIVE ROLES</Text><View style={styles.roleList}>{user.roles.map((role) => <View key={role} style={[styles.miniRolePill,nightMode&&darkStyles.rolePill]}><Text style={[styles.miniRoleText,nightMode&&darkStyles.accentText]}>{role}</Text></View>)}</View></View>
    <Text style={styles.panelSectionTitle}>CHANGE PASSWORD</Text>
    <Text style={styles.inputLabel}>CURRENT PASSWORD</Text><TextInput value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry placeholder="Enter current password" placeholderTextColor="#929A96" style={[styles.profileInput,nightMode&&darkStyles.input,nightMode&&darkStyles.primaryText]}/>
    <Text style={styles.inputLabel}>NEW PASSWORD</Text><TextInput value={newPassword} onChangeText={setNewPassword} secureTextEntry placeholder="At least 8 characters" placeholderTextColor="#929A96" style={[styles.profileInput,nightMode&&darkStyles.input,nightMode&&darkStyles.primaryText]}/>
    <Text style={styles.inputLabel}>CONFIRM NEW PASSWORD</Text><TextInput value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry placeholder="Enter new password again" placeholderTextColor="#929A96" style={[styles.profileInput,nightMode&&darkStyles.input,nightMode&&darkStyles.primaryText]}/>
    <Pressable disabled={saving || !currentPassword || !newPassword || !confirmPassword} onPress={changePassword} style={({pressed})=>[styles.saveProfileButton,(saving || !currentPassword || !newPassword || !confirmPassword)&&styles.authButtonDisabled,pressed&&styles.pressed]}>{saving ? <ActivityIndicator color="#FFF"/> : <Text style={styles.saveProfileText}>Update password</Text>}</Pressable>
  </View>;
}

function ProviderProfilePanel() {
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [isAvailable, setIsAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY).then(async (token) => {
      const response = await fetch(`${API_URL}/api/v1/provider/profile`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const value = (await response.json()).data as ProviderProfileData | null;
      if (value) { setHeadline(value.headline); setBio(value.bio); setSkills(value.skills.join(", ")); setIsAvailable(value.isAvailable); }
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  async function saveProviderProfile() {
    const skillList = [...new Set(skills.split(",").map((skill) => skill.trim()).filter(Boolean))];
    if (headline.trim().length < 3) return Alert.alert("Add a headline", "Use at least 3 characters to describe your service specialty.");
    if (bio.trim().length < 20) return Alert.alert("Tell clients more", "Your provider bio should contain at least 20 characters.");
    if (!skillList.length) return Alert.alert("Add your skills", "Enter at least one skill, separated by commas.");
    setSaving(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/provider/profile`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ headline: headline.trim(), bio: bio.trim(), skills: skillList, isAvailable }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(Array.isArray(result?.message) ? result.message.join("\n") : result?.message ?? "Unable to save your provider profile.");
      setSkills((result.data as ProviderProfileData).skills.join(", "));
      Alert.alert("Provider profile saved", "Your provider information is now ready for your services and dashboard.");
    } catch (error) { Alert.alert("Could not save provider profile", error instanceof Error ? error.message : "Please try again."); }
    finally { setSaving(false); }
  }

  if (loading) return <View style={styles.expandPanel}><ActivityIndicator color={green}/><Text style={styles.panelLoading}>Loading provider profile…</Text></View>;
  return <View style={styles.expandPanel}>
    <Text style={styles.formTitle}>Build your provider identity</Text><Text style={styles.formHelp}>This information helps clients understand your strengths before viewing your services.</Text>
    <Text style={styles.inputLabel}>PROFESSIONAL HEADLINE</Text><TextInput value={headline} onChangeText={setHeadline} maxLength={100} placeholder="e.g. Student graphic designer" placeholderTextColor="#929A96" style={styles.profileInput}/>
    <Text style={styles.inputLabel}>PROVIDER BIO</Text><TextInput value={bio} onChangeText={setBio} multiline maxLength={1000} placeholder="Describe your experience and how you help clients" placeholderTextColor="#929A96" style={[styles.profileInput,styles.bioInput]}/>
    <Text style={styles.inputLabel}>SKILLS</Text><TextInput value={skills} onChangeText={setSkills} placeholder="Logo design, Canva, Illustration" placeholderTextColor="#929A96" style={styles.profileInput}/><Text style={styles.fieldHint}>Separate each skill with a comma.</Text>
    <Pressable onPress={() => setIsAvailable((value) => !value)} style={[styles.availabilityChoice,isAvailable&&styles.availabilityChoiceActive]}><View style={[styles.studentCheckbox,isAvailable&&styles.studentCheckboxActive]}>{isAvailable&&<Text style={styles.studentCheckboxText}>✓</Text>}</View><View style={styles.studentChoiceCopy}><Text style={styles.studentChoiceTitle}>Available for new work</Text><Text style={styles.studentChoiceBody}>Clients can see that you are currently accepting projects.</Text></View></Pressable>
    <Pressable disabled={saving} onPress={saveProviderProfile} style={({pressed})=>[styles.saveProfileButton,saving&&styles.authButtonDisabled,pressed&&styles.pressed]}>{saving ? <ActivityIndicator color="#FFF"/> : <Text style={styles.saveProfileText}>Save provider profile</Text>}</Pressable>
  </View>;
}

function Profile({ nightMode, onNightModeChange, user, schools, avatarVersion, onAvatarChanged, onLogout }: { nightMode: boolean; onNightModeChange: (value: boolean) => void; user: AuthUser; schools: School[]; avatarVersion: number; onAvatarChanged: () => void; onLogout: () => void }) {
  const initials = user.displayName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const isStudent = user.roles.includes("STUDENT");
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [schoolId, setSchoolId] = useState("");
  const [program, setProgram] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [verification, setVerification] = useState<VerificationRequest | null>(null);
  const [studentId, setStudentId] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [submittingVerification, setSubmittingVerification] = useState(false);
  const [activePanel, setActivePanel] = useState<"provider" | "settings" | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (!isStudent) return;
    AsyncStorage.getItem(TOKEN_KEY).then(async (token) => {
      if (!token || !API_URL) return;
      const response = await fetch(`${API_URL}/api/v1/profile/student`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const result = await response.json();
      const value = result.data as StudentProfile | null;
      if (value) { setProfile(value); setSchoolId(value.schoolId); setProgram(value.program ?? ""); setYearLevel(value.yearLevel ? String(value.yearLevel) : ""); setBio(value.bio ?? ""); }
      const verificationResponse = await fetch(`${API_URL}/api/v1/profile/student/verification`, { headers: { Authorization: `Bearer ${token}` } });
      if (verificationResponse.ok) setVerification((await verificationResponse.json()).data ?? null);
    }).catch(() => undefined);
  }, [isStudent]);

  async function saveProfile() {
    if (!schoolId || !program.trim() || !yearLevel) return Alert.alert("Complete your profile", "Select a school and enter your program and year level.");
    setSaving(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/profile/student`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ schoolId, program: program.trim(), yearLevel: Number(yearLevel), bio: bio.trim() || undefined }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message ?? "Unable to save your profile.");
      setProfile(result.data);
      Alert.alert("Profile saved", "Your student information is ready for school verification.");
    } catch (error) { Alert.alert("Could not save profile", error instanceof Error ? error.message : "Please try again."); }
    finally { setSaving(false); }
  }

  async function chooseStudentId() {
    const result = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "application/pdf"], copyToCacheDirectory: true, multiple: false });
    if (!result.canceled) setStudentId(result.assets[0]);
  }

  async function submitVerification() {
    if (!profile) return Alert.alert("Save your profile first", "Your school, program, and year level are required before verification.");
    if (!studentId) return Alert.alert("Select your student ID", "Choose a clear JPG, PNG, or PDF up to 5 MB.");
    if ((studentId.size ?? 0) > 5 * 1024 * 1024) return Alert.alert("File is too large", "Choose a student ID file no larger than 5 MB.");
    setSubmittingVerification(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const form = new FormData();
      form.append("studentId", { uri: studentId.uri, name: studentId.name, type: studentId.mimeType ?? "application/octet-stream" } as unknown as Blob);
      const response = await fetch(`${API_URL}/api/v1/profile/student/verification`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(Array.isArray(result?.message) ? result.message.join("\n") : result?.message ?? "Unable to submit verification.");
      setVerification(result.data);
      setProfile({ ...profile, verificationStatus: "PENDING" });
      setStudentId(null);
      Alert.alert("Submitted for review", "A CampusGig administrator can now review your student ID.");
    } catch (error) { Alert.alert("Submission failed", error instanceof Error ? error.message : "Please try again."); }
    finally { setSubmittingVerification(false); }
  }

  async function chooseProfilePicture() {
    const result = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png"], copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return;
    const picture = result.assets[0];
    if ((picture.size ?? 0) > 5 * 1024 * 1024) return Alert.alert("Picture is too large", "Choose a JPG or PNG image no larger than 5 MB.");
    setUploadingAvatar(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const form = new FormData();
      form.append("avatar", { uri: picture.uri, name: picture.name, type: picture.mimeType ?? "image/jpeg" } as unknown as Blob);
      const response = await fetch(`${API_URL}/api/v1/profile/avatar`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join("\n") : payload?.message ?? "Unable to upload your profile picture.");
      onAvatarChanged();
      Alert.alert("Profile picture updated", "Your new picture is now shown on your CampusGig account.");
    } catch (error) { Alert.alert("Upload failed", error instanceof Error ? error.message : "Please try again."); }
    finally { setUploadingAvatar(false); }
  }

  const profileAvatar = <Pressable onPress={chooseProfilePicture} disabled={uploadingAvatar} style={({pressed})=>[styles.profileAvatarButton,pressed&&styles.pressed]}>
    <View style={styles.profileAvatar}>{uploadingAvatar ? <ActivityIndicator color={green}/> : user.hasAvatar ? <Image source={{ uri: `${API_URL}/api/v1/profile/avatar/${user.id}?v=${avatarVersion}` }} style={styles.profileAvatarImage}/> : <Text style={styles.profileAvatarText}>{initials}</Text>}</View>
    <View style={styles.avatarEditBadge}><Text style={styles.avatarEditText}>＋</Text></View>
  </Pressable>;

  const normalizedProgram = program.trim();
  const normalizedBio = bio.trim();
  const numericYearLevel = Number(yearLevel);
  const profileChanged = profile
    ? schoolId !== profile.schoolId || normalizedProgram !== (profile.program ?? "") || numericYearLevel !== (profile.yearLevel ?? 0) || normalizedBio !== (profile.bio ?? "")
    : Boolean(schoolId || normalizedProgram || yearLevel || normalizedBio);
  const canSaveProfile = Boolean(schoolId && normalizedProgram && numericYearLevel > 0 && profileChanged && !saving && schools.length > 0);

  const appearanceSetting = <View style={[styles.settingRow,nightMode&&darkStyles.outline]}><View style={[styles.settingIcon,nightMode&&darkStyles.card]}><Text style={styles.settingIconText}>◐</Text></View><View style={styles.settingCopy}><Text style={[styles.settingTitle,nightMode&&darkStyles.primaryText]}>Night mode</Text><Text style={[styles.settingSubtitle,nightMode&&darkStyles.mutedText]}>Use a darker theme for comfortable viewing</Text></View><ThemeToggle value={nightMode} onChange={onNightModeChange}/></View>;

  if (!isStudent) return <ScrollView style={[styles.screen,nightMode&&darkStyles.surface]} contentContainerStyle={styles.standardContent} keyboardShouldPersistTaps="handled"><Text style={styles.eyebrow}>YOUR CAMPUSGIG</Text><Text style={[styles.pageTitle,nightMode&&darkStyles.primaryText]}>Client profile</Text><View style={[styles.profileCard,nightMode&&darkStyles.card]}>{profileAvatar}<Text style={styles.avatarHelp}>Tap to change profile picture</Text><Text style={[styles.profileTitle,nightMode&&darkStyles.primaryText]}>{user.displayName}</Text><Text style={[styles.profileSubtitle,nightMode&&darkStyles.mutedText]}>{user.email}</Text><View style={styles.rolePill}><Text style={styles.rolePillText}>CLIENT</Text></View></View><View style={[styles.clientInfoCard,nightMode&&darkStyles.card]}><Text style={[styles.formTitle,nightMode&&darkStyles.primaryText]}>You’re using CampusGig as a client</Text><Text style={[styles.formHelp,nightMode&&darkStyles.mutedText]}>You can browse services, choose preferred schools, place orders, message providers, and leave reviews. This account does not claim student status, so student verification and provider tools are hidden.</Text></View><Text style={styles.groupLabel}>APPEARANCE</Text>{appearanceSetting}<Text style={styles.groupLabel}>ACCOUNT</Text><Pressable onPress={() => setActivePanel(activePanel === "settings" ? null : "settings")} style={[styles.settingRow,nightMode&&darkStyles.outline]}><View style={[styles.settingIcon,nightMode&&darkStyles.card]}><Text style={styles.settingIconText}>⚙</Text></View><View style={styles.settingCopy}><Text style={[styles.settingTitle,nightMode&&darkStyles.primaryText]}>Account settings</Text><Text style={[styles.settingSubtitle,nightMode&&darkStyles.mutedText]}>Roles and password security</Text></View><Text style={styles.chevron}>{activePanel === "settings" ? "⌃" : "›"}</Text></Pressable>{activePanel === "settings"&&<AccountSettings user={user} nightMode={nightMode}/>}<Pressable onPress={onLogout} style={({pressed})=>[styles.logoutButton,nightMode&&darkStyles.outline,pressed&&styles.pressed]}><Text style={styles.logoutText}>Sign out</Text></Pressable></ScrollView>;

  const completion = profile?.verificationStatus === "APPROVED" ? 80 : profile ? 55 : 20;
  const canSubmit = Boolean(profile && studentId && !submittingVerification && profile.verificationStatus !== "PENDING" && profile.verificationStatus !== "APPROVED");
  return <ScrollView style={[styles.screen,nightMode&&darkStyles.surface]} contentContainerStyle={styles.standardContent} keyboardShouldPersistTaps="handled">
    <Text style={styles.eyebrow}>YOUR CAMPUSGIG</Text><Text style={[styles.pageTitle,nightMode&&darkStyles.primaryText]}>Profile</Text>
    <View style={[styles.profileCard,nightMode&&darkStyles.card]}>{profileAvatar}<Text style={styles.avatarHelp}>Tap to change profile picture</Text><Text style={[styles.profileTitle,nightMode&&darkStyles.primaryText]}>{user.displayName}</Text><Text style={[styles.profileSubtitle,nightMode&&darkStyles.mutedText]}>{user.email}</Text><View style={styles.rolePill}><Text style={styles.rolePillText}>{profile?.verificationStatus ?? user.roles.join(" · ")}</Text></View><View style={styles.completionTrack}><View style={[styles.completionFill,{width:`${completion}%`}]}/></View><Text style={styles.completionText}>{completion}% profile complete</Text></View>
    <Text style={styles.groupLabel}>APPEARANCE</Text>{appearanceSetting}
    <Text style={styles.groupLabel}>STUDENT INFORMATION</Text>
    <View style={[styles.profileForm,nightMode&&darkStyles.card]}>
      <Text style={[styles.formTitle,nightMode&&darkStyles.primaryText]}>Set up your campus identity</Text><Text style={[styles.formHelp,nightMode&&darkStyles.mutedText]}>This information connects you to the correct participating school.</Text>
      <Text style={styles.inputLabel}>PARTICIPATING SCHOOL</Text>
      {schools.length === 0 ? <View style={styles.noSchools}><Text style={styles.noSchoolsTitle}>No active schools yet</Text><Text style={styles.noSchoolsBody}>An administrator must add and activate a real participating school first.</Text></View> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.profileSchoolChips}>{schools.map((school) => <Pressable key={school.id} onPress={() => setSchoolId(school.id)} style={[styles.profileSchoolChip,schoolId === school.id && styles.profileSchoolChipActive]}><Text style={[styles.profileSchoolChipText,schoolId === school.id && styles.profileSchoolChipTextActive]}>{school.shortName || school.name}</Text></Pressable>)}</ScrollView>}
      <Text style={styles.inputLabel}>PROGRAM / COURSE</Text><TextInput value={program} onChangeText={setProgram} placeholder="e.g. BS Information Technology" placeholderTextColor="#929A96" style={[styles.profileInput,nightMode&&darkStyles.input,nightMode&&darkStyles.primaryText]}/>
      <Text style={styles.inputLabel}>YEAR LEVEL</Text><TextInput value={yearLevel} onChangeText={(value) => setYearLevel(value.replace(/[^0-9]/g,""))} placeholder="e.g. 3" placeholderTextColor="#929A96" keyboardType="number-pad" maxLength={2} style={[styles.profileInput,nightMode&&darkStyles.input,nightMode&&darkStyles.primaryText]}/>
      <Text style={styles.inputLabel}>SHORT BIO (OPTIONAL)</Text><TextInput value={bio} onChangeText={setBio} placeholder="Tell the campus community about yourself" placeholderTextColor="#929A96" multiline maxLength={500} style={[styles.profileInput,styles.bioInput,nightMode&&darkStyles.input,nightMode&&darkStyles.primaryText]}/>
      <Pressable disabled={!canSaveProfile} onPress={saveProfile} style={({pressed})=>[styles.saveProfileButton,!canSaveProfile&&styles.authButtonDisabled,pressed&&styles.pressed]}>{saving ? <ActivityIndicator color="#FFF"/> : <Text style={styles.saveProfileText}>{profile && !profileChanged ? "Student profile saved" : "Save student profile"}</Text>}</Pressable>
    </View>
    <Text style={styles.groupLabel}>SCHOOL VERIFICATION</Text>
    <View style={[styles.verificationCard,nightMode&&darkStyles.card]}>
      <Text style={[styles.formTitle,nightMode&&darkStyles.primaryText]}>Verify your student identity</Text><Text style={[styles.formHelp,nightMode&&darkStyles.mutedText]}>Upload a clear student ID. It stays private and is available only to authorized CampusGig administrators.</Text>
      {profile?.verificationStatus === "APPROVED" ? <View style={styles.verifiedNotice}><Text style={styles.verifiedNoticeTitle}>✓ Student verified</Text><Text style={styles.verifiedNoticeBody}>You are eligible to set up a provider profile.</Text></View> : profile?.verificationStatus === "PENDING" ? <View style={styles.pendingNotice}><Text style={styles.pendingNoticeTitle}>Review in progress</Text><Text style={styles.pendingNoticeBody}>Submitted {verification ? new Date(verification.submittedAt).toLocaleDateString() : "recently"}. You can continue using CampusGig while waiting.</Text></View> : <>
        <Pressable onPress={chooseStudentId} style={({pressed})=>[styles.filePicker,pressed&&styles.pressed]}><Text style={styles.filePickerIcon}>▤</Text><View style={styles.filePickerCopy}><Text style={styles.filePickerTitle}>{studentId?.name ?? "Choose student ID"}</Text><Text style={styles.filePickerBody}>{studentId ? `${Math.max(1, Math.round((studentId.size ?? 0) / 1024))} KB selected` : "JPG, PNG, or PDF · maximum 5 MB"}</Text></View><Text style={styles.filePickerAction}>Browse</Text></Pressable>
        {profile?.verificationStatus === "REJECTED" && <View style={styles.rejectedNotice}><Text style={styles.rejectedNoticeTitle}>Previous request needs attention</Text><Text style={styles.rejectedNoticeBody}>{verification?.rejectionReason ?? "Please choose a clearer document and submit again."}</Text></View>}
        <Pressable disabled={!canSubmit} onPress={submitVerification} style={({pressed})=>[styles.saveProfileButton,!canSubmit&&styles.authButtonDisabled,pressed&&styles.pressed]}>{submittingVerification ? <ActivityIndicator color="#FFF"/> : <Text style={styles.saveProfileText}>Submit for verification</Text>}</Pressable>
      </>}
    </View>
    <Text style={styles.groupLabel}>NEXT STEPS</Text>
    <Pressable onPress={() => user.roles.includes("PROVIDER") ? setActivePanel(activePanel === "provider" ? null : "provider") : Alert.alert("Provider access is locked", "Complete student verification first. Once approved, CampusGig automatically adds the Provider role to your account.")} style={styles.settingRow}><View style={styles.settingIcon}><Text style={styles.settingIconText}>✦</Text></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>Provider profile</Text><Text style={styles.settingSubtitle}>{user.roles.includes("PROVIDER") ? "Headline, bio, skills and availability" : "Unlocks after student verification"}</Text></View><Text style={styles.chevron}>{activePanel === "provider" ? "⌃" : "›"}</Text></Pressable>
    {activePanel === "provider"&&user.roles.includes("PROVIDER")&&<ProviderProfilePanel/>}
    <Pressable onPress={() => setActivePanel(activePanel === "settings" ? null : "settings")} style={styles.settingRow}><View style={styles.settingIcon}><Text style={styles.settingIconText}>⚙</Text></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>Account settings</Text><Text style={styles.settingSubtitle}>Roles and password security</Text></View><Text style={styles.chevron}>{activePanel === "settings" ? "⌃" : "›"}</Text></Pressable>
    {activePanel === "settings"&&<AccountSettings user={user} nightMode={nightMode}/>}
    <Pressable onPress={onLogout} style={({pressed})=>[styles.logoutButton,pressed&&styles.pressed]}><Text style={styles.logoutText}>Sign out</Text></Pressable>
  </ScrollView>;
}

function ThemeToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => { Animated.spring(position,{toValue:value?1:0,useNativeDriver:true,damping:15,stiffness:190,mass:.55}).start(); },[value]);
  return <Pressable accessibilityRole="switch" accessibilityState={{checked:value}} accessibilityLabel="Night mode" onPress={()=>onChange(!value)} style={[styles.themeToggle,value&&styles.themeToggleActive]}><Text style={styles.themeSun}>☀</Text><Text style={styles.themeMoon}>☾</Text><Animated.View style={[styles.themeKnob,{transform:[{translateX:position.interpolate({inputRange:[0,1],outputRange:[0,28]})}]}]}><Text style={styles.themeKnobIcon}>{value?"☾":"☀"}</Text></Animated.View></Pressable>;
}

function BottomNav({ nightMode, tab, setTab }: { nightMode: boolean; tab: Tab; setTab: (tab: Tab) => void }) {
  const items: {id:Tab;icon:string;label:string}[]=[{id:"home",icon:"⌂",label:"Discover"},{id:"orders",icon:"▱",label:"Orders"},{id:"messages",icon:"◌",label:"Messages"},{id:"profile",icon:"◎",label:"Profile"}];
  return <View style={[styles.bottomNav,nightMode&&darkStyles.navigation]}>{items.map((item)=><Pressable key={item.id} onPress={()=>setTab(item.id)} style={({pressed})=>[styles.navItem,pressed&&styles.navPressed]}><Text style={[styles.navIcon,nightMode&&darkStyles.mutedText,tab===item.id&&styles.navActive]}>{item.icon}</Text><Text style={[styles.navLabel,nightMode&&darkStyles.mutedText,tab===item.id&&styles.navActive]}>{item.label}</Text>{tab===item.id&&<View style={styles.activePip}/>}</Pressable>)}</View>;
}

const green="#0F6B4F",ink="#17211D",muted="#66716B";
const styles=StyleSheet.create({
  authSafe:{flex:1,backgroundColor:"#F5F4EE",alignItems:"center",justifyContent:"center",overflow:"hidden"},authKeyboard:{flex:1,width:"100%"},authThemeToggle:{position:"absolute",right:18,top:(NativeStatusBar.currentHeight??0)+13,zIndex:10},authBlobOne:{position:"absolute",width:220,height:220,borderRadius:110,backgroundColor:"#DFEDB6",top:-125,right:-95,opacity:.68},authBlobTwo:{position:"absolute",width:170,height:170,borderRadius:85,backgroundColor:"#DCEDE5",bottom:-100,left:-75,opacity:.75},authLoading:{color:muted,fontSize:12,marginTop:13,fontWeight:"700"},authContent:{flexGrow:1,width:"100%",maxWidth:430,alignSelf:"center",paddingHorizontal:22,paddingVertical:28,justifyContent:"center"},authIdentity:{alignItems:"center",justifyContent:"center"},authMark:{width:52,height:52,borderRadius:15,backgroundColor:green,alignItems:"center",justifyContent:"center",shadowColor:green,shadowOpacity:.18,shadowRadius:12,shadowOffset:{width:0,height:6},elevation:3},authMarkText:{color:"#D9F36A",fontSize:26,fontWeight:"900"},authBrand:{color:ink,fontSize:24,fontWeight:"900",marginTop:10},authKicker:{color:green,fontSize:7,letterSpacing:1.05,fontWeight:"900",marginTop:2},authIntro:{marginTop:21,alignItems:"center",paddingHorizontal:12},authTitle:{color:ink,fontSize:25,lineHeight:31,fontWeight:"900",letterSpacing:-.4,textAlign:"center"},authSubtitle:{color:muted,fontSize:11,lineHeight:17,marginTop:6,textAlign:"center",maxWidth:320},authCard:{width:"100%",alignSelf:"center",backgroundColor:"#FFF",borderRadius:20,padding:18,marginTop:20,borderWidth:1,borderColor:"#E1E6E2",shadowColor:ink,shadowOpacity:.07,shadowRadius:18,shadowOffset:{width:0,height:8},elevation:4},authTabs:{height:45,borderRadius:12,backgroundColor:"#EEF2EF",padding:4,flexDirection:"row",marginBottom:15,position:"relative",overflow:"hidden"},authTabSlider:{position:"absolute",left:4,top:4,bottom:4,borderRadius:9,backgroundColor:"#FFF",shadowColor:ink,shadowOpacity:.1,shadowRadius:5,shadowOffset:{width:0,height:2},elevation:2},authTab:{flex:1,alignItems:"center",justifyContent:"center",zIndex:2},authTabActive:{backgroundColor:"#FFF"},authTabText:{color:muted,fontSize:11,fontWeight:"800"},authTabTextActive:{color:green,fontWeight:"900"},inputLabel:{color:muted,fontSize:8,letterSpacing:1.2,fontWeight:"900",marginBottom:6,marginTop:8},inputShell:{height:49,borderWidth:1,borderColor:"#DDE3DF",borderRadius:11,paddingHorizontal:12,backgroundColor:"#FCFDFC",flexDirection:"row",alignItems:"center"},inputGlyph:{width:23,color:green,fontSize:13,fontWeight:"900"},authInput:{flex:1,height:47,color:ink,fontSize:13,paddingVertical:0},passwordToggle:{color:green,fontSize:8,fontWeight:"900",letterSpacing:.6,paddingLeft:8},passwordHint:{flexDirection:"row",alignItems:"center",gap:6,marginTop:6},hintCheck:{color:"#A6ADA9",fontSize:11,fontWeight:"900"},hintCheckReady:{color:green},hintText:{color:muted,fontSize:9},authButton:{height:51,borderRadius:11,backgroundColor:green,flexDirection:"row",alignItems:"center",justifyContent:"center",marginTop:15,paddingHorizontal:16},authButtonDisabled:{opacity:.45},authButtonText:{color:"#FFF",fontSize:12,fontWeight:"900"},authButtonArrow:{position:"absolute",right:17,color:"#D9F36A",fontSize:19,fontWeight:"700"},authTextLink:{color:green,fontSize:10,fontWeight:"900",textAlign:"center",marginTop:13},studentChoice:{marginTop:12,padding:11,borderWidth:1,borderColor:"#DDE5E0",borderRadius:11,backgroundColor:"#F8FAF9",flexDirection:"row",alignItems:"center",gap:10},studentChoiceActive:{borderColor:green,backgroundColor:"#EEF6F1"},studentCheckbox:{width:22,height:22,borderRadius:6,borderWidth:1,borderColor:"#B9C5BE",alignItems:"center",justifyContent:"center"},studentCheckboxActive:{borderColor:green,backgroundColor:green},studentCheckboxText:{color:"#FFF",fontSize:11,fontWeight:"900"},studentChoiceCopy:{flex:1},studentChoiceTitle:{color:ink,fontSize:10,fontWeight:"900"},studentChoiceBody:{color:muted,fontSize:8,lineHeight:12,marginTop:2},authTrust:{backgroundColor:"#EEF6F1",borderRadius:10,paddingHorizontal:11,paddingVertical:9,flexDirection:"row",alignItems:"center",gap:8,marginTop:12},authTrustIcon:{width:20,height:20,borderRadius:10,textAlign:"center",lineHeight:20,backgroundColor:"#D9F36A",color:green,fontSize:10,fontWeight:"900"},authTrustText:{flex:1,color:"#50675C",fontSize:9,lineHeight:14},authNote:{color:"#7C8580",fontSize:8,lineHeight:13,textAlign:"center",marginTop:14,paddingHorizontal:22},
  safe:{flex:1,backgroundColor:"#FFF",paddingTop:NativeStatusBar.currentHeight??0},app:{flex:1,backgroundColor:"#FFF",maxWidth:500,width:"100%",alignSelf:"center",overflow:"hidden"},animatedScreen:{flex:1},screen:{flex:1,backgroundColor:"#FFF"},homeContent:{paddingBottom:120},standardContent:{padding:22,paddingBottom:120},pressed:{opacity:.72,transform:[{scale:.985}]},
  header:{paddingHorizontal:22,paddingVertical:16,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},hello:{fontSize:9,letterSpacing:1.6,fontWeight:"800",color:muted},brand:{color:ink,fontSize:24,lineHeight:29,fontWeight:"900"},brandAccent:{color:green},headerActions:{flexDirection:"row",gap:10,alignItems:"center"},roundButton:{width:38,height:38,borderRadius:19,borderWidth:1,borderColor:"#E4E8E5",alignItems:"center",justifyContent:"center"},bell:{fontSize:18,color:ink},mobileNotificationBadge:{position:"absolute",right:-5,top:-5,minWidth:18,height:18,borderRadius:9,paddingHorizontal:4,backgroundColor:"#D95045",borderWidth:2,borderColor:"#FFF",alignItems:"center",justifyContent:"center"},mobileNotificationBadgeText:{color:"#FFF",fontSize:7,fontWeight:"900"},account:{width:38,height:38,borderRadius:19,backgroundColor:"#E1EEE7",alignItems:"center",justifyContent:"center",overflow:"hidden"},accountImage:{width:"100%",height:"100%"},accountText:{color:green,fontWeight:"900"},
  hero:{marginHorizontal:15,padding:24,paddingTop:30,borderRadius:24,backgroundColor:"#F4F3EC",overflow:"hidden"},heroCircleOne:{position:"absolute",width:155,height:155,borderRadius:90,backgroundColor:"#E4EFC0",right:-55,top:-35},heroCircleTwo:{position:"absolute",width:85,height:85,borderRadius:50,backgroundColor:"#D9EAE1",right:22,bottom:-43},heroKicker:{color:green,fontSize:9,letterSpacing:1.3,fontWeight:"900"},heroTitle:{color:ink,fontSize:30,lineHeight:37,fontWeight:"900",marginTop:10,maxWidth:310},heroBody:{color:muted,fontSize:13,lineHeight:20,marginTop:10,maxWidth:310},search:{height:54,marginTop:22,borderRadius:13,backgroundColor:"#FFF",flexDirection:"row",alignItems:"center",paddingHorizontal:15,shadowColor:ink,shadowOpacity:.08,shadowRadius:15,shadowOffset:{width:0,height:6},elevation:3},searchIcon:{color:green,fontSize:23,marginRight:10},searchInput:{flex:1,fontSize:13,color:ink},
  schoolSection:{marginTop:25},schoolLabel:{paddingHorizontal:22,color:green,fontSize:9,letterSpacing:1.5,fontWeight:"900"},schoolHelp:{paddingHorizontal:22,color:muted,fontSize:11,marginTop:5},schoolChips:{paddingHorizontal:22,paddingTop:12,gap:9},schoolChip:{height:38,paddingHorizontal:15,borderRadius:19,borderWidth:1,borderColor:"#DDE4DF",backgroundColor:"#FFF",alignItems:"center",justifyContent:"center"},schoolChipActive:{backgroundColor:green,borderColor:green},schoolChipText:{color:ink,fontSize:11,fontWeight:"800"},schoolChipTextActive:{color:"#FFF"},
  sectionTitleRow:{paddingHorizontal:22,marginTop:31,marginBottom:15,flexDirection:"row",alignItems:"flex-end",justifyContent:"space-between"},eyebrow:{color:green,fontSize:9,letterSpacing:1.5,fontWeight:"900"},sectionTitle:{color:ink,fontSize:21,lineHeight:27,fontWeight:"900",marginTop:5},link:{color:green,fontSize:12,fontWeight:"800"},categories:{paddingHorizontal:22,gap:11},category:{width:132,minHeight:145,borderWidth:1,borderColor:"#E3E7E4",borderRadius:16,padding:14,backgroundColor:"#FFF"},categorySelected:{borderColor:green,backgroundColor:"#F7FBF8"},categoryIcon:{width:42,height:42,borderRadius:11,alignItems:"center",justifyContent:"center"},categoryIconText:{fontSize:14,fontWeight:"900"},categoryName:{color:ink,fontSize:13,fontWeight:"800",marginTop:18},categoryCount:{color:muted,fontSize:10,marginTop:4},
  emptyCard:{marginHorizontal:22,borderWidth:1,borderColor:"#E3E7E4",borderRadius:18,alignItems:"center",paddingHorizontal:28,paddingVertical:34,backgroundColor:"#FBFCFB"},emptyIcon:{width:54,height:54,borderRadius:27,backgroundColor:"#E2F0E8",alignItems:"center",justifyContent:"center",marginBottom:16},emptyIconText:{color:green,fontSize:25,fontWeight:"800"},emptyTitle:{color:ink,fontSize:16,fontWeight:"900",textAlign:"center",marginTop:12},emptyBody:{color:muted,fontSize:12,lineHeight:18,textAlign:"center",marginTop:7,maxWidth:290},providerButton:{marginTop:21,borderRadius:10,backgroundColor:green,paddingHorizontal:18,height:43,flexDirection:"row",alignItems:"center",gap:13},providerButtonText:{color:"#FFF",fontSize:12,fontWeight:"800"},providerArrow:{color:"#D9F36A",fontSize:18},
  serviceCard:{marginHorizontal:22,marginBottom:14,borderWidth:1,borderColor:"#E3E7E4",borderRadius:16,overflow:"hidden",backgroundColor:"#FFF"},serviceCover:{width:"100%",height:168,backgroundColor:"#E4ECE7"},serviceCoverFallback:{width:"100%",height:130,backgroundColor:"#E4F0E9",alignItems:"center",justifyContent:"center"},serviceCoverFallbackText:{color:green,fontSize:38,fontWeight:"900"},serviceCardBody:{padding:17},serviceCategory:{color:green,fontSize:9,fontWeight:"900",letterSpacing:1},serviceTitle:{color:ink,fontSize:16,fontWeight:"800",lineHeight:22,marginTop:8},serviceProviderRow:{flexDirection:"row",alignItems:"center",gap:8,marginTop:8},serviceProviderAvatar:{width:28,height:28,borderRadius:14},serviceProviderFallback:{width:28,height:28,borderRadius:14,backgroundColor:"#DCEBE4",alignItems:"center",justifyContent:"center"},serviceProviderFallbackText:{color:green,fontSize:9,fontWeight:"900"},serviceMeta:{color:muted,fontSize:10,flex:1},serviceFooter:{flexDirection:"row",justifyContent:"space-between",borderTopWidth:1,borderTopColor:"#EDF0EE",marginTop:15,paddingTop:12},serviceRating:{color:"#D18E13",fontSize:11,fontWeight:"800"},servicePrice:{color:ink,fontSize:12,fontWeight:"900"},safetyCard:{marginHorizontal:22,marginTop:22,borderRadius:15,padding:17,backgroundColor:"#E9F3ED",flexDirection:"row",gap:13},safetyIcon:{width:36,height:36,borderRadius:18,backgroundColor:"#D9F36A",alignItems:"center",justifyContent:"center"},safetyCopy:{flex:1},safetyTitle:{color:green,fontSize:12,fontWeight:"900"},safetyBody:{color:"#4E665B",fontSize:10,lineHeight:15,marginTop:4},
  modalBackdrop:{flex:1,backgroundColor:"rgba(10,20,16,.45)",justifyContent:"flex-end"},bookingSheet:{height:"92%",backgroundColor:"#FFF",borderTopLeftRadius:25,borderTopRightRadius:25,paddingTop:9,overflow:"hidden"},sheetHandle:{width:42,height:4,borderRadius:3,backgroundColor:"#CCD3CF",alignSelf:"center",marginBottom:7},bookingHeader:{paddingHorizontal:20,paddingBottom:14,borderBottomWidth:1,borderBottomColor:"#E8ECE9",flexDirection:"row",alignItems:"flex-start",gap:12},bookingHeaderCopy:{flex:1},bookingTitle:{color:ink,fontSize:20,lineHeight:26,fontWeight:"900",marginTop:6},closeButton:{width:36,height:36,borderRadius:18,backgroundColor:"#F0F3F1",alignItems:"center",justifyContent:"center"},closeButtonText:{color:ink,fontSize:25,lineHeight:27},bookingContent:{padding:20,paddingBottom:45},bookingCover:{width:"100%",height:190,borderRadius:16,backgroundColor:"#E4ECE7"},bookingDescription:{color:muted,fontSize:11,lineHeight:18,marginTop:15},packageChoice:{borderWidth:1,borderColor:"#DDE4DF",borderRadius:14,padding:14,marginBottom:10,backgroundColor:"#FFF"},packageChoiceActive:{borderColor:green,backgroundColor:"#F1F8F4"},packageChoiceTop:{flexDirection:"row",justifyContent:"space-between",gap:12},packageTier:{color:green,fontSize:8,letterSpacing:1.1,fontWeight:"900"},packageName:{color:ink,fontSize:13,fontWeight:"900",marginTop:4},packagePrice:{color:green,fontSize:16,fontWeight:"900"},packageDescription:{color:muted,fontSize:10,lineHeight:15,marginTop:10},packageMeta:{color:ink,fontSize:9,fontWeight:"700",marginTop:9},requirementsInput:{minHeight:125,borderWidth:1,borderColor:"#DDE3DF",borderRadius:12,padding:13,color:ink,fontSize:12,lineHeight:18,textAlignVertical:"top",backgroundColor:"#FFF"},requirementsCount:{color:muted,fontSize:8,textAlign:"right",marginTop:6},bookingSummary:{marginTop:18,padding:14,borderRadius:13,backgroundColor:"#F2F6F3",flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12},summaryLabel:{color:muted,fontSize:8,fontWeight:"900",letterSpacing:1},summaryHelp:{color:muted,fontSize:8,marginTop:4,maxWidth:210},summaryPrice:{color:green,fontSize:20,fontWeight:"900"},providerNotice:{color:muted,fontSize:9,textAlign:"center",marginTop:10},ordersIntro:{color:muted,fontSize:11,lineHeight:17,marginTop:7,marginBottom:22},orderCard:{borderWidth:1,borderColor:"#DFE5E1",borderRadius:16,padding:17,marginBottom:13,backgroundColor:"#FFF"},orderTop:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:10},orderNumber:{color:muted,fontSize:8,fontWeight:"900",letterSpacing:.7},orderStatus:{paddingHorizontal:9,paddingVertical:5,borderRadius:12,backgroundColor:"#FFF1CE"},orderStatusText:{color:"#8D690F",fontSize:7,fontWeight:"900"},orderTitle:{color:ink,fontSize:15,lineHeight:20,fontWeight:"900",marginTop:13},orderProvider:{color:muted,fontSize:9,marginTop:5},orderMetaRow:{borderTopWidth:1,borderTopColor:"#E9EDEB",marginTop:14,paddingTop:13,flexDirection:"row",justifyContent:"space-between",gap:10},orderMetaLabel:{color:muted,fontSize:7,fontWeight:"900",letterSpacing:.7},orderMetaValue:{color:ink,fontSize:9,fontWeight:"800",marginTop:4,maxWidth:105},
  pageTitle:{color:ink,fontSize:32,fontWeight:"900",marginTop:7},largeEmpty:{flex:1,minHeight:500,alignItems:"center",justifyContent:"center",paddingBottom:70},largeEmptyIcon:{width:72,height:72,borderRadius:36,backgroundColor:"#E5F1EA",alignItems:"center",justifyContent:"center"},largeEmptyIconText:{color:green,fontSize:30,fontWeight:"800"},primaryButton:{marginTop:23,backgroundColor:green,borderRadius:10,paddingHorizontal:23,paddingVertical:13},primaryButtonText:{color:"#FFF",fontSize:12,fontWeight:"800"},
  profileCard:{alignItems:"center",borderWidth:1,borderColor:"#E3E7E4",borderRadius:18,padding:24,marginTop:25},profileAvatarButton:{position:"relative"},profileAvatar:{width:76,height:76,borderRadius:38,backgroundColor:"#DFEDE5",alignItems:"center",justifyContent:"center",overflow:"hidden",borderWidth:2,borderColor:"#FFF"},profileAvatarImage:{width:"100%",height:"100%"},profileAvatarText:{color:green,fontSize:18,fontWeight:"900"},avatarEditBadge:{position:"absolute",right:-2,bottom:-2,width:25,height:25,borderRadius:13,backgroundColor:green,borderWidth:2,borderColor:"#FFF",alignItems:"center",justifyContent:"center"},avatarEditText:{color:"#FFF",fontSize:16,fontWeight:"900",lineHeight:18},avatarHelp:{color:muted,fontSize:8,marginTop:8},profileTitle:{color:ink,fontSize:17,fontWeight:"900",marginTop:10},profileSubtitle:{color:muted,textAlign:"center",fontSize:11,lineHeight:17,marginTop:6},rolePill:{backgroundColor:"#E5F1EA",borderRadius:12,paddingHorizontal:10,paddingVertical:5,marginTop:11},rolePillText:{color:green,fontSize:8,fontWeight:"900",letterSpacing:.7},completionTrack:{height:7,width:"100%",backgroundColor:"#E8ECEA",borderRadius:8,marginTop:20},completionFill:{height:7,width:"20%",backgroundColor:green,borderRadius:8},completionText:{color:muted,fontSize:9,marginTop:7,alignSelf:"flex-end"},groupLabel:{color:muted,fontSize:9,letterSpacing:1.4,fontWeight:"900",marginTop:28,marginBottom:7},settingRow:{minHeight:72,borderBottomWidth:1,borderBottomColor:"#EDF0EE",flexDirection:"row",alignItems:"center",gap:12},settingIcon:{width:40,height:40,borderRadius:11,backgroundColor:"#F0F5F2",alignItems:"center",justifyContent:"center"},settingIconText:{color:green,fontWeight:"900"},settingCopy:{flex:1},settingTitle:{color:ink,fontSize:12,fontWeight:"800"},settingSubtitle:{color:muted,fontSize:9,marginTop:4},chevron:{color:"#9AA29E",fontSize:24},expandPanel:{backgroundColor:"#F8FAF9",borderWidth:1,borderColor:"#DDE5E0",borderRadius:16,padding:16,marginTop:10,marginBottom:6},panelLoading:{color:muted,fontSize:10,textAlign:"center",marginTop:8},panelSectionTitle:{color:green,fontSize:9,letterSpacing:1.2,fontWeight:"900",marginTop:20,marginBottom:3},accountDetail:{paddingVertical:11,borderBottomWidth:1,borderBottomColor:"#E5EAE7"},accountDetailLabel:{color:muted,fontSize:8,letterSpacing:1.1,fontWeight:"900",marginBottom:6},accountDetailValue:{color:ink,fontSize:11,fontWeight:"700"},roleList:{flexDirection:"row",flexWrap:"wrap",gap:6},miniRolePill:{backgroundColor:"#E5F1EA",borderRadius:10,paddingHorizontal:9,paddingVertical:5},miniRoleText:{color:green,fontSize:8,fontWeight:"900",letterSpacing:.5},fieldHint:{color:muted,fontSize:8,marginTop:6},availabilityChoice:{marginTop:14,padding:11,borderWidth:1,borderColor:"#DDE5E0",borderRadius:11,backgroundColor:"#FFF",flexDirection:"row",alignItems:"center",gap:10},availabilityChoiceActive:{borderColor:green,backgroundColor:"#EEF6F1"},logoutButton:{height:40,minWidth:112,paddingHorizontal:20,borderWidth:1,borderColor:"#D9DFDB",borderRadius:20,alignSelf:"center",alignItems:"center",justifyContent:"center",marginTop:25},logoutText:{color:"#A33E36",fontSize:11,fontWeight:"900"},
  clientInfoCard:{borderWidth:1,borderColor:"#DDE6E0",borderRadius:16,padding:18,backgroundColor:"#F8FBF9",marginTop:18},
  profileForm:{borderWidth:1,borderColor:"#E3E7E4",borderRadius:18,padding:18,backgroundColor:"#FBFCFB"},formTitle:{color:ink,fontSize:16,fontWeight:"900"},formHelp:{color:muted,fontSize:10,lineHeight:16,marginTop:5,marginBottom:10},noSchools:{borderRadius:11,backgroundColor:"#FFF5DE",borderWidth:1,borderColor:"#F0DDAE",padding:13},noSchoolsTitle:{color:"#86600D",fontSize:11,fontWeight:"900"},noSchoolsBody:{color:"#7A6A48",fontSize:9,lineHeight:14,marginTop:4},profileSchoolChips:{gap:8,paddingVertical:2},profileSchoolChip:{borderWidth:1,borderColor:"#DDE3DF",borderRadius:18,paddingHorizontal:13,height:36,alignItems:"center",justifyContent:"center",backgroundColor:"#FFF"},profileSchoolChipActive:{backgroundColor:green,borderColor:green},profileSchoolChipText:{color:ink,fontSize:10,fontWeight:"800"},profileSchoolChipTextActive:{color:"#FFF"},profileInput:{height:49,borderWidth:1,borderColor:"#DDE3DF",borderRadius:11,paddingHorizontal:13,color:ink,fontSize:12,backgroundColor:"#FFF"},bioInput:{height:90,paddingTop:12,textAlignVertical:"top"},saveProfileButton:{height:49,borderRadius:11,backgroundColor:green,alignItems:"center",justifyContent:"center",marginTop:17},saveProfileText:{color:"#FFF",fontSize:11,fontWeight:"900"},
  verificationCard:{borderWidth:1,borderColor:"#DDE6E0",borderRadius:18,padding:18,backgroundColor:"#F8FBF9"},filePicker:{minHeight:70,borderWidth:1,borderStyle:"dashed",borderColor:"#B7C9BE",borderRadius:12,backgroundColor:"#FFF",padding:12,flexDirection:"row",alignItems:"center",gap:11},filePickerIcon:{width:36,height:36,lineHeight:36,textAlign:"center",borderRadius:10,backgroundColor:"#E5F1EA",color:green,fontSize:16,fontWeight:"900"},filePickerCopy:{flex:1},filePickerTitle:{color:ink,fontSize:11,fontWeight:"900"},filePickerBody:{color:muted,fontSize:9,marginTop:4},filePickerAction:{color:green,fontSize:9,fontWeight:"900"},pendingNotice:{borderRadius:11,backgroundColor:"#FFF5DE",borderWidth:1,borderColor:"#F0DDAE",padding:13},pendingNoticeTitle:{color:"#86600D",fontSize:11,fontWeight:"900"},pendingNoticeBody:{color:"#7A6A48",fontSize:9,lineHeight:14,marginTop:4},verifiedNotice:{borderRadius:11,backgroundColor:"#E7F5EC",borderWidth:1,borderColor:"#B9DDC6",padding:13},verifiedNoticeTitle:{color:green,fontSize:11,fontWeight:"900"},verifiedNoticeBody:{color:"#4E665B",fontSize:9,lineHeight:14,marginTop:4},rejectedNotice:{borderRadius:11,backgroundColor:"#FFF0EE",borderWidth:1,borderColor:"#F0C6C0",padding:13,marginTop:10},rejectedNoticeTitle:{color:"#A33E36",fontSize:10,fontWeight:"900"},rejectedNoticeBody:{color:"#76504B",fontSize:9,lineHeight:14,marginTop:4},
  bottomNav:{position:"absolute",bottom:0,left:0,right:0,height:77,backgroundColor:"#FFF",borderTopWidth:1,borderTopColor:"#E4E8E5",flexDirection:"row",paddingHorizontal:7,paddingBottom:5,shadowColor:ink,shadowOpacity:.07,shadowRadius:12,shadowOffset:{width:0,height:-5}},navItem:{flex:1,alignItems:"center",justifyContent:"center",position:"relative"},navPressed:{opacity:.58,transform:[{scale:.92}]},navIcon:{color:"#8A938E",fontSize:20,fontWeight:"700"},navLabel:{color:"#8A938E",fontSize:9,fontWeight:"700",marginTop:4},navActive:{color:green},activePip:{position:"absolute",bottom:1,width:18,height:3,borderRadius:2,backgroundColor:"#D9F36A"},
  themeToggle:{width:62,height:34,borderRadius:17,backgroundColor:"#E8ECE9",padding:3,justifyContent:"center",position:"relative"},themeToggleActive:{backgroundColor:"#2B604D"},themeKnob:{position:"absolute",left:3,width:28,height:28,borderRadius:14,backgroundColor:"#FFF",alignItems:"center",justifyContent:"center",shadowColor:"#000",shadowOpacity:.18,shadowRadius:3,shadowOffset:{width:0,height:2},elevation:2},themeKnobIcon:{fontSize:15,color:"#75580B"},themeSun:{position:"absolute",left:9,fontSize:11,color:"#9A7208"},themeMoon:{position:"absolute",right:9,fontSize:14,color:"#EAF2EE"},
});

const darkStyles=StyleSheet.create({
  surface:{backgroundColor:"#111713"},
  card:{backgroundColor:"#1C2520",borderColor:"#34423A"},
  navigation:{backgroundColor:"#18201C",borderTopColor:"#34423A",shadowColor:"#000"},
  primaryText:{color:"#F2F6F3"},
  mutedText:{color:"#AAB6AF"},
  outline:{borderColor:"#34423A",borderBottomColor:"#34423A",borderTopColor:"#34423A"},
  input:{backgroundColor:"#151D19",borderColor:"#3B4A42"},
  rolePill:{backgroundColor:"#203B30"},
  accentText:{color:"#83D6B6"},
  authBlob:{backgroundColor:"#244035",opacity:.45},
});
