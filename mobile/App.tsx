import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ActivityIndicator, Alert, Animated, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StatusBar as NativeStatusBar, StyleSheet, Text, TextInput, View } from "react-native";

type Tab = "home" | "orders" | "messages" | "profile";
type Category = { id: string; name: string; icon: string; tint: string; ink: string; serviceCount: number };
type School = { id: string; name: string; shortName: string; city: string };
type Service = { id: string; title: string; category: string; provider: string; schoolId: string; school: string; price: number; rating: number };
type AuthUser = { id: string; email: string; displayName: string; status: string; roles: string[] };
type AuthResponse = { accessToken: string; user: AuthUser };
const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
const TOKEN_KEY = "campusgig.accessToken";

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
  const [loading, setLoading] = useState(Boolean(API_URL));
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY).then(async (token) => {
      if (!token || !API_URL) return;
      const response = await fetch(`${API_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) setAuthUser(await response.json());
      else await AsyncStorage.removeItem(TOKEN_KEY);
    }).catch(() => AsyncStorage.removeItem(TOKEN_KEY)).finally(() => setAuthChecking(false));
  }, []);

  async function authenticate(mode: "login" | "register", values: { email: string; password: string; displayName?: string }) {
    if (!API_URL) throw new Error("The CampusGig API address is not configured.");
    const response = await fetch(`${API_URL}/api/v1/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message ?? "Unable to continue. Please check your details.");
    const session = payload as AuthResponse;
    await AsyncStorage.setItem(TOKEN_KEY, session.accessToken);
    setAuthUser(session.user);
  }

  async function logout() {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setAuthUser(null);
    setTab("home");
  }

  useEffect(() => {
    if (!API_URL) return;
    const loadingFallback = setTimeout(() => setLoading(false), 2500);
    Promise.allSettled([
      fetch(`${API_URL}/api/v1/categories`).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${API_URL}/api/v1/schools`).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${API_URL}/api/v1/services`).then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([categoryResult, schoolResult, serviceResult]) => {
      if (categoryResult.status === "fulfilled" && categoryResult.value.data?.length) {
        setCategories(categoryResult.value.data.map((category: Category) => ({ ...category, tint: defaultCategories.find((item) => item.id === category.id)?.tint ?? "#DEF2E6", ink: defaultCategories.find((item) => item.id === category.id)?.ink ?? "#287E56" })));
      }
      if (schoolResult.status === "fulfilled") setSchools(schoolResult.value.data ?? []);
      if (serviceResult.status === "fulfilled") setServices(serviceResult.value.data ?? []);
    }).finally(() => { clearTimeout(loadingFallback); setLoading(false); });
    return () => clearTimeout(loadingFallback);
  }, []);

  const filteredServices = services.filter((service) => `${service.title} ${service.provider} ${service.category}`.toLowerCase().includes(query.toLowerCase()) && (!selectedCategory || service.category === selectedCategory) && (!selectedSchoolId || service.schoolId === selectedSchoolId));
  if (authChecking) return <SafeAreaView style={styles.authSafe}><StatusBar style="dark"/><ActivityIndicator size="large" color={green}/><Text style={styles.authLoading}>Opening CampusGig</Text></SafeAreaView>;
  if (!authUser) return <AuthScreen onAuthenticate={authenticate}/>;
  return <SafeAreaView style={styles.safe}><StatusBar style="dark"/><View style={styles.app}>
    {tab === "home" && <Home query={query} setQuery={setQuery} categories={categories} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} schools={schools} selectedSchoolId={selectedSchoolId} setSelectedSchoolId={setSelectedSchoolId} services={filteredServices} loading={loading}/>} 
    {tab === "orders" && <EmptyScreen eyebrow="MY PROJECTS" title="Orders" icon="◇" message="Your bookings and their progress will appear here." action="Browse services" onAction={() => setTab("home")}/>} 
    {tab === "messages" && <EmptyScreen eyebrow="CONVERSATIONS" title="Messages" icon="◌" message="Order conversations will appear here after a booking is created."/>} 
    {tab === "profile" && <Profile user={authUser} onLogout={logout}/>}<BottomNav tab={tab} setTab={setTab}/>
  </View></SafeAreaView>;
}

function AuthScreen({ onAuthenticate }: { onAuthenticate: (mode: "login" | "register", values: { email: string; password: string; displayName?: string }) => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tabTrackWidth, setTabTrackWidth] = useState(0);
  const sliderX = useRef(new Animated.Value(0)).current;
  const formMotion = useRef(new Animated.Value(1)).current;
  const formReady = Boolean(email.trim() && password.length >= 8 && (mode === "login" || displayName.trim().length >= 2));

  function switchMode(nextMode: "login" | "register") {
    if (nextMode === mode) return;
    const segmentWidth = Math.max(0, (tabTrackWidth - 8) / 2);
    Animated.timing(sliderX, { toValue: nextMode === "register" ? segmentWidth : 0, duration: 240, useNativeDriver: true }).start();
    Animated.timing(formMotion, { toValue: 0, duration: 110, useNativeDriver: true }).start(() => {
      setMode(nextMode);
      setPassword("");
      setShowPassword(false);
      formMotion.setValue(0);
      Animated.spring(formMotion, { toValue: 1, damping: 18, stiffness: 190, mass: .65, useNativeDriver: true }).start();
    });
  }

  async function submit() {
    if (!email.trim() || !password || (mode === "register" && !displayName.trim())) return Alert.alert("Complete your details", "Please fill in every required field.");
    setSubmitting(true);
    try { await onAuthenticate(mode, { email: email.trim(), password, ...(mode === "register" ? { displayName: displayName.trim() } : {}) }); }
    catch (error) { Alert.alert(mode === "login" ? "Login failed" : "Registration failed", error instanceof Error ? error.message : "Please try again."); }
    finally { setSubmitting(false); }
  }

  return <SafeAreaView style={styles.authSafe}>
    <StatusBar style="dark"/>
    <View style={styles.authBlobOne}/><View style={styles.authBlobTwo}/>
    <KeyboardAvoidingView style={styles.authKeyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.authContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.authIdentity}><View style={styles.authMark}><Text style={styles.authMarkText}>C</Text></View><Text style={styles.authBrand}>Campus<Text style={styles.brandAccent}>Gig</Text></Text></View>
        <View style={styles.authIntro}><Text style={styles.authTitle}>Welcome to CampusGig</Text><Text style={styles.authSubtitle}>Your trusted marketplace for verified student skills and services.</Text></View>
        <View style={styles.authCard}>
          <View style={styles.authTabs} onLayout={(event) => setTabTrackWidth(event.nativeEvent.layout.width)}>
            {tabTrackWidth > 0 && <Animated.View pointerEvents="none" style={[styles.authTabSlider, { width: (tabTrackWidth - 8) / 2, transform: [{ translateX: sliderX }] }]}/>}
            <Pressable onPress={() => switchMode("login")} style={styles.authTab}><Text style={[styles.authTabText, mode === "login" && styles.authTabTextActive]}>Log in</Text></Pressable>
            <Pressable onPress={() => switchMode("register")} style={styles.authTab}><Text style={[styles.authTabText, mode === "register" && styles.authTabTextActive]}>Sign up</Text></Pressable>
          </View>
          <Animated.View style={{ opacity: formMotion, transform: [{ translateY: formMotion.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
            {mode === "register" && <><Text style={styles.inputLabel}>FULL NAME</Text><View style={styles.inputShell}><Text style={styles.inputGlyph}>◎</Text><TextInput value={displayName} onChangeText={setDisplayName} placeholder="Your full name" placeholderTextColor="#929A96" style={styles.authInput} autoCapitalize="words" returnKeyType="next"/></View></>}
            <Text style={styles.inputLabel}>EMAIL ADDRESS</Text><View style={styles.inputShell}><Text style={styles.inputGlyph}>@</Text><TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#929A96" style={styles.authInput} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" returnKeyType="next"/></View>
            <Text style={styles.inputLabel}>PASSWORD</Text><View style={styles.inputShell}><Text style={styles.inputGlyph}>◇</Text><TextInput value={password} onChangeText={setPassword} placeholder="At least 8 characters" placeholderTextColor="#929A96" style={styles.authInput} secureTextEntry={!showPassword} autoCapitalize="none" returnKeyType="done" onSubmitEditing={formReady ? submit : undefined}/><Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10}><Text style={styles.passwordToggle}>{showPassword ? "HIDE" : "SHOW"}</Text></Pressable></View>
            <View style={styles.passwordHint}><Text style={[styles.hintCheck, password.length >= 8 && styles.hintCheckReady]}>{password.length >= 8 ? "✓" : "○"}</Text><Text style={styles.hintText}>Minimum 8 characters</Text></View>
            <Pressable disabled={submitting || !formReady} onPress={submit} style={[styles.authButton, (submitting || !formReady) && styles.authButtonDisabled]}>{submitting ? <ActivityIndicator color="#FFF"/> : <><Text style={styles.authButtonText}>{mode === "login" ? "Log in" : "Create account"}</Text><Text style={styles.authButtonArrow}>→</Text></>}</Pressable>
            <View style={styles.authTrust}><Text style={styles.authTrustIcon}>✓</Text><Text style={styles.authTrustText}>{mode === "login" ? "Your saved profile and marketplace activity are waiting." : "School verification comes after account creation."}</Text></View>
          </Animated.View>
        </View>
        <Text style={styles.authNote}>By continuing, you agree to the CampusGig community guidelines.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function Home({ query, setQuery, categories, selectedCategory, setSelectedCategory, schools, selectedSchoolId, setSelectedSchoolId, services, loading }: { query: string; setQuery: (value: string) => void; categories: Category[]; selectedCategory: string | null; setSelectedCategory: (value: string | null) => void; schools: School[]; selectedSchoolId: string; setSelectedSchoolId: (value: string) => void; services: Service[]; loading: boolean }) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
    <View style={styles.header}><View><Text style={styles.hello}>WELCOME TO</Text><Text style={styles.brand}>Campus<Text style={styles.brandAccent}>Gig</Text></Text></View><View style={styles.headerActions}><Pressable style={styles.roundButton}><Text style={styles.bell}>♧</Text><View style={styles.notificationDot}/></Pressable><View style={styles.account}><Text style={styles.accountText}>?</Text></View></View></View>
    <View style={styles.hero}><View style={styles.heroCircleOne}/><View style={styles.heroCircleTwo}/><Text style={styles.heroKicker}>STUDENT SKILLS, REAL OPPORTUNITIES</Text><Text style={styles.heroTitle}>What do you need help with today?</Text><Text style={styles.heroBody}>Find trusted services from verified students in your campus community.</Text><View style={styles.search}><Text style={styles.searchIcon}>⌕</Text><TextInput value={query} onChangeText={setQuery} placeholder="Search student services" placeholderTextColor="#8C9690" style={styles.searchInput}/></View></View>
    <View style={styles.schoolSection}><Text style={styles.schoolLabel}>PREFERRED SCHOOL</Text><Text style={styles.schoolHelp}>Show providers from a particular school</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.schoolChips}><Pressable onPress={() => setSelectedSchoolId("")} style={[styles.schoolChip, !selectedSchoolId && styles.schoolChipActive]}><Text style={[styles.schoolChipText, !selectedSchoolId && styles.schoolChipTextActive]}>All schools</Text></Pressable>{schools.map((school) => <Pressable key={school.id} onPress={() => setSelectedSchoolId(school.id)} style={[styles.schoolChip, selectedSchoolId === school.id && styles.schoolChipActive]}><Text style={[styles.schoolChipText, selectedSchoolId === school.id && styles.schoolChipTextActive]}>{school.shortName || school.name}</Text></Pressable>)}</ScrollView></View>
    <View style={styles.sectionTitleRow}><View><Text style={styles.eyebrow}>EXPLORE</Text><Text style={styles.sectionTitle}>Browse categories</Text></View>{selectedCategory && <Pressable onPress={() => setSelectedCategory(null)}><Text style={styles.link}>Clear</Text></Pressable>}</View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>{categories.map((category) => <Pressable key={category.id} onPress={() => setSelectedCategory(selectedCategory === category.name ? null : category.name)} style={[styles.category, selectedCategory === category.name && styles.categorySelected]}><View style={[styles.categoryIcon,{backgroundColor:category.tint}]}><Text style={[styles.categoryIconText,{color:category.ink}]}>{category.icon}</Text></View><Text style={styles.categoryName}>{category.name}</Text><Text style={styles.categoryCount}>{category.serviceCount} services</Text></Pressable>)}</ScrollView>
    <View style={styles.sectionTitleRow}><View><Text style={styles.eyebrow}>MARKETPLACE</Text><Text style={styles.sectionTitle}>{selectedCategory ?? "Available services"}</Text></View></View>
    {loading ? <View style={styles.emptyCard}><ActivityIndicator color="#0F6B4F"/><Text style={styles.emptyTitle}>Connecting to CampusGig</Text><Text style={styles.emptyBody}>Loading real marketplace data.</Text></View> : services.length === 0 ? <View style={styles.emptyCard}><View style={styles.emptyIcon}><Text style={styles.emptyIconText}>◇</Text></View><Text style={styles.emptyTitle}>No services published yet</Text><Text style={styles.emptyBody}>Verified provider services will appear here automatically.</Text><Pressable style={styles.providerButton}><Text style={styles.providerButtonText}>Become a provider</Text><Text style={styles.providerArrow}>→</Text></Pressable></View> : services.map((service) => <View key={service.id} style={styles.serviceCard}><Text style={styles.serviceCategory}>{service.category}</Text><Text style={styles.serviceTitle}>{service.title}</Text><Text style={styles.serviceMeta}>{service.provider} · {service.school}</Text><View style={styles.serviceFooter}><Text style={styles.serviceRating}>★ {service.rating}</Text><Text style={styles.servicePrice}>From ₱{service.price}</Text></View></View>)}
    <View style={styles.safetyCard}><View style={styles.safetyIcon}><Text>✓</Text></View><View style={styles.safetyCopy}><Text style={styles.safetyTitle}>Built for campus trust</Text><Text style={styles.safetyBody}>Student verification, order-based messaging, and clear project tracking.</Text></View></View>
  </ScrollView>;
}

function EmptyScreen({ eyebrow, title, icon, message, action, onAction }: { eyebrow: string; title: string; icon: string; message: string; action?: string; onAction?: () => void }) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.standardContent}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.pageTitle}>{title}</Text><View style={styles.largeEmpty}><View style={styles.largeEmptyIcon}><Text style={styles.largeEmptyIconText}>{icon}</Text></View><Text style={styles.emptyTitle}>Nothing here yet</Text><Text style={styles.emptyBody}>{message}</Text>{action && <Pressable style={styles.primaryButton} onPress={onAction}><Text style={styles.primaryButtonText}>{action}</Text></Pressable>}</View></ScrollView>;
}

function Profile({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const initials = user.displayName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  return <ScrollView style={styles.screen} contentContainerStyle={styles.standardContent}><Text style={styles.eyebrow}>YOUR CAMPUSGIG</Text><Text style={styles.pageTitle}>Profile</Text><View style={styles.profileCard}><View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{initials}</Text></View><Text style={styles.profileTitle}>{user.displayName}</Text><Text style={styles.profileSubtitle}>{user.email}</Text><View style={styles.rolePill}><Text style={styles.rolePillText}>{user.roles.join(" · ")}</Text></View><View style={styles.completionTrack}><View style={styles.completionFill}/></View><Text style={styles.completionText}>Account created · profile setup pending</Text></View><Text style={styles.groupLabel}>ACCOUNT SETUP</Text>{[["◎","Student information","Name, program and year level"],["▣","School verification","Submit your school email and student ID"],["✦","Provider profile","Skills, bio and portfolio"],["⚙","Account settings","Security and notifications"]].map(([icon,title,subtitle]) => <Pressable key={title} style={styles.settingRow}><View style={styles.settingIcon}><Text style={styles.settingIconText}>{icon}</Text></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingSubtitle}>{subtitle}</Text></View><Text style={styles.chevron}>›</Text></Pressable>)}<Pressable onPress={onLogout} style={styles.logoutButton}><Text style={styles.logoutText}>Sign out</Text></Pressable></ScrollView>;
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const items: {id:Tab;icon:string;label:string}[]=[{id:"home",icon:"⌂",label:"Discover"},{id:"orders",icon:"▱",label:"Orders"},{id:"messages",icon:"◌",label:"Messages"},{id:"profile",icon:"◎",label:"Profile"}];
  return <View style={styles.bottomNav}>{items.map((item)=><Pressable key={item.id} onPress={()=>setTab(item.id)} style={styles.navItem}><Text style={[styles.navIcon,tab===item.id&&styles.navActive]}>{item.icon}</Text><Text style={[styles.navLabel,tab===item.id&&styles.navActive]}>{item.label}</Text>{tab===item.id&&<View style={styles.activePip}/>}</Pressable>)}</View>;
}

const green="#0F6B4F",ink="#17211D",muted="#66716B";
const styles=StyleSheet.create({
  authSafe:{flex:1,backgroundColor:"#F5F4EE",alignItems:"center",justifyContent:"center",overflow:"hidden"},authKeyboard:{flex:1,width:"100%"},authBlobOne:{position:"absolute",width:220,height:220,borderRadius:110,backgroundColor:"#DFEDB6",top:-125,right:-95,opacity:.68},authBlobTwo:{position:"absolute",width:170,height:170,borderRadius:85,backgroundColor:"#DCEDE5",bottom:-100,left:-75,opacity:.75},authLoading:{color:muted,fontSize:12,marginTop:13,fontWeight:"700"},authContent:{flexGrow:1,width:"100%",maxWidth:430,alignSelf:"center",paddingHorizontal:22,paddingVertical:28,justifyContent:"center"},authIdentity:{alignItems:"center",justifyContent:"center"},authMark:{width:52,height:52,borderRadius:15,backgroundColor:green,alignItems:"center",justifyContent:"center",shadowColor:green,shadowOpacity:.18,shadowRadius:12,shadowOffset:{width:0,height:6},elevation:3},authMarkText:{color:"#D9F36A",fontSize:26,fontWeight:"900"},authBrand:{color:ink,fontSize:24,fontWeight:"900",marginTop:10},authKicker:{color:green,fontSize:7,letterSpacing:1.05,fontWeight:"900",marginTop:2},authIntro:{marginTop:21,alignItems:"center",paddingHorizontal:12},authTitle:{color:ink,fontSize:25,lineHeight:31,fontWeight:"900",letterSpacing:-.4,textAlign:"center"},authSubtitle:{color:muted,fontSize:11,lineHeight:17,marginTop:6,textAlign:"center",maxWidth:320},authCard:{width:"100%",alignSelf:"center",backgroundColor:"#FFF",borderRadius:20,padding:18,marginTop:20,borderWidth:1,borderColor:"#E1E6E2",shadowColor:ink,shadowOpacity:.07,shadowRadius:18,shadowOffset:{width:0,height:8},elevation:4},authTabs:{height:45,borderRadius:12,backgroundColor:"#EEF2EF",padding:4,flexDirection:"row",marginBottom:15,position:"relative",overflow:"hidden"},authTabSlider:{position:"absolute",left:4,top:4,bottom:4,borderRadius:9,backgroundColor:"#FFF",shadowColor:ink,shadowOpacity:.1,shadowRadius:5,shadowOffset:{width:0,height:2},elevation:2},authTab:{flex:1,alignItems:"center",justifyContent:"center",zIndex:2},authTabActive:{backgroundColor:"#FFF"},authTabText:{color:muted,fontSize:11,fontWeight:"800"},authTabTextActive:{color:green,fontWeight:"900"},inputLabel:{color:muted,fontSize:8,letterSpacing:1.2,fontWeight:"900",marginBottom:6,marginTop:8},inputShell:{height:49,borderWidth:1,borderColor:"#DDE3DF",borderRadius:11,paddingHorizontal:12,backgroundColor:"#FCFDFC",flexDirection:"row",alignItems:"center"},inputGlyph:{width:23,color:green,fontSize:13,fontWeight:"900"},authInput:{flex:1,height:47,color:ink,fontSize:13,paddingVertical:0},passwordToggle:{color:green,fontSize:8,fontWeight:"900",letterSpacing:.6,paddingLeft:8},passwordHint:{flexDirection:"row",alignItems:"center",gap:6,marginTop:6},hintCheck:{color:"#A6ADA9",fontSize:11,fontWeight:"900"},hintCheckReady:{color:green},hintText:{color:muted,fontSize:9},authButton:{height:51,borderRadius:11,backgroundColor:green,flexDirection:"row",alignItems:"center",justifyContent:"center",marginTop:15,paddingHorizontal:16},authButtonDisabled:{opacity:.45},authButtonText:{color:"#FFF",fontSize:12,fontWeight:"900"},authButtonArrow:{position:"absolute",right:17,color:"#D9F36A",fontSize:19,fontWeight:"700"},authTrust:{backgroundColor:"#EEF6F1",borderRadius:10,paddingHorizontal:11,paddingVertical:9,flexDirection:"row",alignItems:"center",gap:8,marginTop:12},authTrustIcon:{width:20,height:20,borderRadius:10,textAlign:"center",lineHeight:20,backgroundColor:"#D9F36A",color:green,fontSize:10,fontWeight:"900"},authTrustText:{flex:1,color:"#50675C",fontSize:9,lineHeight:14},authNote:{color:"#7C8580",fontSize:8,lineHeight:13,textAlign:"center",marginTop:14,paddingHorizontal:22},
  safe:{flex:1,backgroundColor:"#FFF",paddingTop:NativeStatusBar.currentHeight??0},app:{flex:1,backgroundColor:"#FFF",maxWidth:500,width:"100%",alignSelf:"center",overflow:"hidden"},screen:{flex:1,backgroundColor:"#FFF"},homeContent:{paddingBottom:120},standardContent:{padding:22,paddingBottom:120},
  header:{paddingHorizontal:22,paddingVertical:16,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},hello:{fontSize:9,letterSpacing:1.6,fontWeight:"800",color:muted},brand:{color:ink,fontSize:24,lineHeight:29,fontWeight:"900"},brandAccent:{color:green},headerActions:{flexDirection:"row",gap:10,alignItems:"center"},roundButton:{width:38,height:38,borderRadius:19,borderWidth:1,borderColor:"#E4E8E5",alignItems:"center",justifyContent:"center"},bell:{fontSize:18,color:ink},notificationDot:{width:7,height:7,borderRadius:4,backgroundColor:"#F07568",position:"absolute",right:7,top:6,borderWidth:1,borderColor:"#FFF"},account:{width:38,height:38,borderRadius:19,backgroundColor:"#E1EEE7",alignItems:"center",justifyContent:"center"},accountText:{color:green,fontWeight:"900"},
  hero:{marginHorizontal:15,padding:24,paddingTop:30,borderRadius:24,backgroundColor:"#F4F3EC",overflow:"hidden"},heroCircleOne:{position:"absolute",width:155,height:155,borderRadius:90,backgroundColor:"#E4EFC0",right:-55,top:-35},heroCircleTwo:{position:"absolute",width:85,height:85,borderRadius:50,backgroundColor:"#D9EAE1",right:22,bottom:-43},heroKicker:{color:green,fontSize:9,letterSpacing:1.3,fontWeight:"900"},heroTitle:{color:ink,fontSize:30,lineHeight:37,fontWeight:"900",marginTop:10,maxWidth:310},heroBody:{color:muted,fontSize:13,lineHeight:20,marginTop:10,maxWidth:310},search:{height:54,marginTop:22,borderRadius:13,backgroundColor:"#FFF",flexDirection:"row",alignItems:"center",paddingHorizontal:15,shadowColor:ink,shadowOpacity:.08,shadowRadius:15,shadowOffset:{width:0,height:6},elevation:3},searchIcon:{color:green,fontSize:23,marginRight:10},searchInput:{flex:1,fontSize:13,color:ink},
  schoolSection:{marginTop:25},schoolLabel:{paddingHorizontal:22,color:green,fontSize:9,letterSpacing:1.5,fontWeight:"900"},schoolHelp:{paddingHorizontal:22,color:muted,fontSize:11,marginTop:5},schoolChips:{paddingHorizontal:22,paddingTop:12,gap:9},schoolChip:{height:38,paddingHorizontal:15,borderRadius:19,borderWidth:1,borderColor:"#DDE4DF",backgroundColor:"#FFF",alignItems:"center",justifyContent:"center"},schoolChipActive:{backgroundColor:green,borderColor:green},schoolChipText:{color:ink,fontSize:11,fontWeight:"800"},schoolChipTextActive:{color:"#FFF"},
  sectionTitleRow:{paddingHorizontal:22,marginTop:31,marginBottom:15,flexDirection:"row",alignItems:"flex-end",justifyContent:"space-between"},eyebrow:{color:green,fontSize:9,letterSpacing:1.5,fontWeight:"900"},sectionTitle:{color:ink,fontSize:21,lineHeight:27,fontWeight:"900",marginTop:5},link:{color:green,fontSize:12,fontWeight:"800"},categories:{paddingHorizontal:22,gap:11},category:{width:132,minHeight:145,borderWidth:1,borderColor:"#E3E7E4",borderRadius:16,padding:14,backgroundColor:"#FFF"},categorySelected:{borderColor:green,backgroundColor:"#F7FBF8"},categoryIcon:{width:42,height:42,borderRadius:11,alignItems:"center",justifyContent:"center"},categoryIconText:{fontSize:14,fontWeight:"900"},categoryName:{color:ink,fontSize:13,fontWeight:"800",marginTop:18},categoryCount:{color:muted,fontSize:10,marginTop:4},
  emptyCard:{marginHorizontal:22,borderWidth:1,borderColor:"#E3E7E4",borderRadius:18,alignItems:"center",paddingHorizontal:28,paddingVertical:34,backgroundColor:"#FBFCFB"},emptyIcon:{width:54,height:54,borderRadius:27,backgroundColor:"#E2F0E8",alignItems:"center",justifyContent:"center",marginBottom:16},emptyIconText:{color:green,fontSize:25,fontWeight:"800"},emptyTitle:{color:ink,fontSize:16,fontWeight:"900",textAlign:"center",marginTop:12},emptyBody:{color:muted,fontSize:12,lineHeight:18,textAlign:"center",marginTop:7,maxWidth:290},providerButton:{marginTop:21,borderRadius:10,backgroundColor:green,paddingHorizontal:18,height:43,flexDirection:"row",alignItems:"center",gap:13},providerButtonText:{color:"#FFF",fontSize:12,fontWeight:"800"},providerArrow:{color:"#D9F36A",fontSize:18},
  serviceCard:{marginHorizontal:22,marginBottom:12,borderWidth:1,borderColor:"#E3E7E4",borderRadius:16,padding:17},serviceCategory:{color:green,fontSize:9,fontWeight:"900",letterSpacing:1},serviceTitle:{color:ink,fontSize:16,fontWeight:"800",lineHeight:22,marginTop:8},serviceMeta:{color:muted,fontSize:10,marginTop:7},serviceFooter:{flexDirection:"row",justifyContent:"space-between",borderTopWidth:1,borderTopColor:"#EDF0EE",marginTop:15,paddingTop:12},serviceRating:{color:"#D18E13",fontSize:11,fontWeight:"800"},servicePrice:{color:ink,fontSize:12,fontWeight:"900"},safetyCard:{marginHorizontal:22,marginTop:22,borderRadius:15,padding:17,backgroundColor:"#E9F3ED",flexDirection:"row",gap:13},safetyIcon:{width:36,height:36,borderRadius:18,backgroundColor:"#D9F36A",alignItems:"center",justifyContent:"center"},safetyCopy:{flex:1},safetyTitle:{color:green,fontSize:12,fontWeight:"900"},safetyBody:{color:"#4E665B",fontSize:10,lineHeight:15,marginTop:4},
  pageTitle:{color:ink,fontSize:32,fontWeight:"900",marginTop:7},largeEmpty:{flex:1,minHeight:500,alignItems:"center",justifyContent:"center",paddingBottom:70},largeEmptyIcon:{width:72,height:72,borderRadius:36,backgroundColor:"#E5F1EA",alignItems:"center",justifyContent:"center"},largeEmptyIconText:{color:green,fontSize:30,fontWeight:"800"},primaryButton:{marginTop:23,backgroundColor:green,borderRadius:10,paddingHorizontal:23,paddingVertical:13},primaryButtonText:{color:"#FFF",fontSize:12,fontWeight:"800"},
  profileCard:{alignItems:"center",borderWidth:1,borderColor:"#E3E7E4",borderRadius:18,padding:24,marginTop:25},profileAvatar:{width:68,height:68,borderRadius:34,backgroundColor:"#DFEDE5",alignItems:"center",justifyContent:"center"},profileAvatarText:{color:green,fontSize:18,fontWeight:"900"},profileTitle:{color:ink,fontSize:17,fontWeight:"900",marginTop:14},profileSubtitle:{color:muted,textAlign:"center",fontSize:11,lineHeight:17,marginTop:6},rolePill:{backgroundColor:"#E5F1EA",borderRadius:12,paddingHorizontal:10,paddingVertical:5,marginTop:11},rolePillText:{color:green,fontSize:8,fontWeight:"900",letterSpacing:.7},completionTrack:{height:7,width:"100%",backgroundColor:"#E8ECEA",borderRadius:8,marginTop:20},completionFill:{height:7,width:"20%",backgroundColor:green,borderRadius:8},completionText:{color:muted,fontSize:9,marginTop:7,alignSelf:"flex-end"},groupLabel:{color:muted,fontSize:9,letterSpacing:1.4,fontWeight:"900",marginTop:28,marginBottom:7},settingRow:{minHeight:72,borderBottomWidth:1,borderBottomColor:"#EDF0EE",flexDirection:"row",alignItems:"center",gap:12},settingIcon:{width:40,height:40,borderRadius:11,backgroundColor:"#F0F5F2",alignItems:"center",justifyContent:"center"},settingIconText:{color:green,fontWeight:"900"},settingCopy:{flex:1},settingTitle:{color:ink,fontSize:12,fontWeight:"800"},settingSubtitle:{color:muted,fontSize:9,marginTop:4},chevron:{color:"#9AA29E",fontSize:24},logoutButton:{height:46,borderWidth:1,borderColor:"#D9DFDB",borderRadius:11,alignItems:"center",justifyContent:"center",marginTop:25},logoutText:{color:"#A33E36",fontSize:12,fontWeight:"900"},
  bottomNav:{position:"absolute",bottom:0,left:0,right:0,height:77,backgroundColor:"#FFF",borderTopWidth:1,borderTopColor:"#E4E8E5",flexDirection:"row",paddingHorizontal:7,paddingBottom:5,shadowColor:ink,shadowOpacity:.07,shadowRadius:12,shadowOffset:{width:0,height:-5}},navItem:{flex:1,alignItems:"center",justifyContent:"center",position:"relative"},navIcon:{color:"#8A938E",fontSize:20,fontWeight:"700"},navLabel:{color:"#8A938E",fontSize:9,fontWeight:"700",marginTop:4},navActive:{color:green},activePip:{position:"absolute",bottom:1,width:18,height:3,borderRadius:2,backgroundColor:"#D9F36A"},
});
