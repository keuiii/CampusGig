import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { ActivityIndicator, Animated, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { API_URL, STORAGE_KEYS } from "./src/config";
import { defaultCategories } from "./src/catalog";
import { darkStyles, green, styles } from "./src/theme";
import { AuthScreen } from "./src/screens/AuthScreen";
import { Home } from "./src/screens/Home";
import { OrdersScreen } from "./src/screens/OrdersScreen";
import { BottomNav } from "./src/components/BottomNav";
import { Profile } from "./src/screens/Profile";
import { ServiceBookingModal } from "./src/features/orders/ServiceBookingModal";
import { OrderWorkspaceModal } from "./src/features/orders/OrderWorkspaceModal";
import { ConversationModal } from "./src/features/messages/ConversationModal";
import { MessagesInbox } from "./src/features/messages/MessagesInbox";
import type {
  AuthResponse,
  AuthUser,
  Category,
  ConversationInboxItem,
  MobileOrder,
  School,
  Service,
  Tab,
} from "./src/types";
const TOKEN_KEY = STORAGE_KEYS.accessToken;
const NIGHT_MODE_KEY = STORAGE_KEYS.nightMode;
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  offlineAccess: false,
});

function CampusGigApp() {
  const [tab, setTab] = useState<Tab>("home");
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState(defaultCategories);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [orders, setOrders] = useState<MobileOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<MobileOrder | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationInboxItem[]>(
    [],
  );
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationInboxItem | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [loading, setLoading] = useState(Boolean(API_URL));
  const [refreshing, setRefreshing] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(Date.now());
  const [authChecking, setAuthChecking] = useState(true);
  const [nightMode, setNightMode] = useState(false);
  const screenMotion = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    AsyncStorage.getItem(NIGHT_MODE_KEY)
      .then((value) => setNightMode(value === "true"))
      .catch(() => undefined);
    AsyncStorage.getItem(TOKEN_KEY)
      .then(async (token) => {
        if (!token || !API_URL) return;
        const response = await fetch(`${API_URL}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) setAuthUser(await response.json());
        else await AsyncStorage.removeItem(TOKEN_KEY);
      })
      .catch(() => AsyncStorage.removeItem(TOKEN_KEY))
      .finally(() => setAuthChecking(false));
  }, []);

  async function toggleNightMode(value: boolean) {
    setNightMode(value);
    await AsyncStorage.setItem(NIGHT_MODE_KEY, String(value));
  }

  async function authenticate(path: string, values: Record<string, unknown>) {
    if (!API_URL)
      throw new Error("The CampusGig API address is not configured.");
    const response = await fetch(`${API_URL}/api/v1/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        payload?.message ?? "Unable to continue. Please check your details.",
      );
    if (payload?.accessToken) {
      const session = payload as AuthResponse;
      await AsyncStorage.setItem(TOKEN_KEY, session.accessToken);
      setAuthUser(session.user);
    }
    return payload;
  }

  async function logout() {
    await GoogleSignin.signOut().catch(() => null);
    await AsyncStorage.removeItem(TOKEN_KEY);
    setAuthUser(null);
    setTab("home");
  }

  async function loadMarketplace(showRefresh = false) {
    if (!API_URL) return;
    if (showRefresh) setRefreshing(true);
    const loadingFallback = setTimeout(() => setLoading(false), 2500);
    await Promise.allSettled([
      fetch(`${API_URL}/api/v1/categories`).then((response) =>
        response.ok ? response.json() : Promise.reject(),
      ),
      fetch(`${API_URL}/api/v1/schools`).then((response) =>
        response.ok ? response.json() : Promise.reject(),
      ),
      fetch(`${API_URL}/api/v1/services`).then((response) =>
        response.ok ? response.json() : Promise.reject(),
      ),
    ])
      .then(([categoryResult, schoolResult, serviceResult]) => {
        if (
          categoryResult.status === "fulfilled" &&
          categoryResult.value.data?.length
        ) {
          setCategories(
            categoryResult.value.data.map((category: Category) => ({
              ...category,
              tint:
                defaultCategories.find((item) => item.id === category.id)
                  ?.tint ?? "#DEF2E6",
              ink:
                defaultCategories.find((item) => item.id === category.id)
                  ?.ink ?? "#287E56",
            })),
          );
        }
        if (schoolResult.status === "fulfilled")
          setSchools(schoolResult.value.data ?? []);
        if (serviceResult.status === "fulfilled")
          setServices(serviceResult.value.data ?? []);
      })
      .finally(() => {
        clearTimeout(loadingFallback);
        setLoading(false);
        setRefreshing(false);
      });
  }

  useEffect(() => {
    void loadMarketplace();
  }, []);

  async function loadOrders() {
    if (!authUser || !API_URL) return;
    setOrdersLoading(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/orders?scope=client`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) setOrders((await response.json()).data ?? []);
    } finally {
      setOrdersLoading(false);
    }
  }

  async function loadConversations() {
    if (!authUser || !API_URL) return;
    setConversationsLoading(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) setConversations((await response.json()).data ?? []);
    } finally {
      setConversationsLoading(false);
    }
  }

  async function openOrderFromNotification(
    orderId: string,
    notificationType?: string,
  ) {
    if (notificationType === "NEW_MESSAGE") {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const items = (await response.json()).data ?? [];
        setConversations(items);
        const match = items.find(
          (item: ConversationInboxItem) => item.order.id === orderId,
        );
        changeTab("messages");
        if (match) setSelectedConversation(match);
        return;
      }
    }
    const existing = orders.find((order) => order.id === orderId);
    if (existing) {
      setSelectedOrder(existing);
      changeTab("orders");
      return;
    }
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    const response = await fetch(`${API_URL}/api/v1/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const payload = await response.json();
      setSelectedOrder(payload.data);
      changeTab("orders");
    }
  }

  useEffect(() => {
    if (authUser) void loadOrders();
  }, [authUser?.id]);
  useEffect(() => {
    if (tab !== "messages" || !authUser) return;
    void loadConversations();
    const timer = setInterval(() => void loadConversations(), 8000);
    return () => clearInterval(timer);
  }, [tab, authUser?.id]);

  function changeTab(next: Tab) {
    if (next === "orders") void loadOrders();
    if (next === "messages") void loadConversations();
    if (next === tab) return;
    screenMotion.setValue(0);
    setTab(next);
    Animated.spring(screenMotion, {
      toValue: 1,
      damping: 18,
      stiffness: 190,
      mass: 0.75,
      useNativeDriver: true,
    }).start();
  }

  const filteredServices = services.filter(
    (service) =>
      `${service.title} ${service.provider} ${service.category}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!selectedCategory || service.category === selectedCategory) &&
      (!selectedSchoolId || service.schoolId === selectedSchoolId),
  );
  if (authChecking)
    return (
      <SafeAreaView style={styles.authSafe}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={green} />
        <Text style={styles.authLoading}>Opening CampusGig</Text>
      </SafeAreaView>
    );
  if (!authUser)
    return (
      <AuthScreen
        nightMode={nightMode}
        onNightModeChange={toggleNightMode}
        onAuthenticate={authenticate}
      />
    );
  return (
    <SafeAreaView style={[styles.safe, nightMode && darkStyles.surface]}>
      <StatusBar style={nightMode ? "light" : "dark"} />
      <View style={[styles.app, nightMode && darkStyles.surface]}>
        <Animated.View
          style={[
            styles.animatedScreen,
            {
              opacity: screenMotion,
              transform: [
                {
                  translateY: screenMotion.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {tab === "home" && (
            <Home
              nightMode={nightMode}
              user={authUser}
              avatarVersion={avatarVersion}
              query={query}
              setQuery={setQuery}
              categories={categories}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              schools={schools}
              selectedSchoolId={selectedSchoolId}
              setSelectedSchoolId={setSelectedSchoolId}
              services={filteredServices}
              loading={loading}
              refreshing={refreshing}
              onRefresh={() => loadMarketplace(true)}
              onOpenService={setSelectedService}
              onOpenProfile={() => changeTab("profile")}
              onOpenOrder={openOrderFromNotification}
            />
          )}
          {tab === "orders" && (
            <OrdersScreen
              nightMode={nightMode}
              orders={orders}
              loading={ordersLoading}
              onRefresh={loadOrders}
              onBrowse={() => changeTab("home")}
              onOpen={setSelectedOrder}
            />
          )}
          {tab === "messages" && (
            <MessagesInbox
              nightMode={nightMode}
              conversations={conversations}
              loading={conversationsLoading}
              onRefresh={loadConversations}
              onOpen={setSelectedConversation}
            />
          )}
          {tab === "profile" && (
            <Profile
              nightMode={nightMode}
              onNightModeChange={toggleNightMode}
              user={authUser}
              schools={schools}
              avatarVersion={avatarVersion}
              onAvatarChanged={() => {
                setAuthUser((current) =>
                  current ? { ...current, hasAvatar: true } : current,
                );
                setAvatarVersion(Date.now());
              }}
              onLogout={logout}
            />
          )}
        </Animated.View>
        {!selectedService && !selectedOrder && !selectedConversation && (
          <BottomNav nightMode={nightMode} tab={tab} setTab={changeTab} />
        )}
        <ServiceBookingModal
          service={selectedService}
          onClose={() => setSelectedService(null)}
          onCreated={async () => {
            setSelectedService(null);
            await loadOrders();
            changeTab("orders");
          }}
        />
        <OrderWorkspaceModal
          nightMode={nightMode}
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
        <ConversationModal
          nightMode={nightMode}
          conversation={selectedConversation}
          onClose={() => {
            setSelectedConversation(null);
            void loadConversations();
          }}
        />
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <CampusGigApp />
    </SafeAreaProvider>
  );
}
