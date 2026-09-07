import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { API_URL, STORAGE_KEYS } from "../config";
import { darkStyles, green, styles } from "../theme";
import type {
  AuthUser,
  Category,
  MobileNotification,
  School,
  Service,
} from "../types";

export function Home({
  nightMode,
  user,
  avatarVersion,
  query,
  setQuery,
  categories,
  selectedCategory,
  setSelectedCategory,
  schools,
  selectedSchoolId,
  setSelectedSchoolId,
  services,
  loading,
  refreshing,
  onRefresh,
  onOpenService,
  onOpenProfile,
  onOpenOrder,
}: {
  nightMode: boolean;
  user: AuthUser;
  avatarVersion: number;
  query: string;
  setQuery: (value: string) => void;
  categories: Category[];
  selectedCategory: string | null;
  setSelectedCategory: (value: string | null) => void;
  schools: School[];
  selectedSchoolId: string;
  setSelectedSchoolId: (value: string) => void;
  services: Service[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenService: (service: Service) => void;
  onOpenProfile: () => void;
  onOpenOrder: (orderId: string, notificationType?: string) => Promise<void>;
}) {
  const [notifications, setNotifications] = useState<MobileNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  async function loadNotifications(show = false) {
    const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
    if (!token) return;
    const response = await fetch(`${API_URL}/api/v1/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const payload = await response.json();
    const items = (payload.data ?? []) as MobileNotification[];
    setNotifications(items);
    setUnreadCount(payload.unreadCount ?? 0);
    if (show) setNotificationsOpen(true);
  }
  async function openNotification(item: MobileNotification) {
    const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
    if (!item.readAt) {
      await fetch(`${API_URL}/api/v1/notifications/${item.id}/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      setUnreadCount((count) => Math.max(0, count - 1));
      setNotifications((items) =>
        items.map((entry) =>
          entry.id === item.id
            ? { ...entry, readAt: new Date().toISOString() }
            : entry,
        ),
      );
    }
    setNotificationsOpen(false);
    if (item.orderId) await onOpenOrder(item.orderId, item.type);
  }
  useEffect(() => {
    void loadNotifications();
    const timer = setInterval(() => void loadNotifications(), 8000);
    return () => clearInterval(timer);
  }, [user.id]);
  return (
    <>
      <ScrollView
        style={[styles.screen, nightMode && darkStyles.surface]}
        contentContainerStyle={styles.homeContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[green]}
            tintColor={nightMode ? "#D9F36A" : green}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.hello, nightMode && darkStyles.mutedText]}>
              WELCOME TO
            </Text>
            <Text style={[styles.brand, nightMode && darkStyles.primaryText]}>
              Campus<Text style={styles.brandAccent}>Gig</Text>
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => void loadNotifications(true)}
              style={({ pressed }) => [
                styles.roundButton,
                nightMode && darkStyles.outline,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.bell}>🔔</Text>
              {unreadCount > 0 && (
                <View style={styles.mobileNotificationBadge}>
                  <Text style={styles.mobileNotificationBadgeText}>
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={onOpenProfile}
              style={({ pressed }) => [
                styles.account,
                pressed && styles.pressed,
              ]}
            >
              {user.hasAvatar ? (
                <Image
                  source={{
                    uri: `${API_URL}/api/v1/profile/avatar/${user.id}?v=${avatarVersion}`,
                  }}
                  style={styles.accountImage}
                />
              ) : (
                <Text style={styles.accountText}>
                  {user.displayName.charAt(0).toUpperCase()}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
        <View style={[styles.hero, nightMode && darkStyles.card]}>
          <View style={styles.heroCircleOne} />
          <View style={styles.heroCircleTwo} />
          <Text style={styles.heroKicker}>
            STUDENT SKILLS, REAL OPPORTUNITIES
          </Text>
          <Text style={[styles.heroTitle, nightMode && darkStyles.primaryText]}>
            What do you need help with today?
          </Text>
          <Text style={[styles.heroBody, nightMode && darkStyles.mutedText]}>
            Find trusted services from verified students in your campus
            community.
          </Text>
          <View style={[styles.search, nightMode && darkStyles.input]}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search student services"
              placeholderTextColor="#8C9690"
              style={[styles.searchInput, nightMode && darkStyles.primaryText]}
            />
          </View>
        </View>
        <View style={styles.schoolSection}>
          <Text style={styles.schoolLabel}>PREFERRED SCHOOL</Text>
          <Text style={[styles.schoolHelp, nightMode && darkStyles.mutedText]}>
            {schools.length} participating school
            {schools.length === 1 ? "" : "s"} available · Show providers from a
            particular school
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.schoolChips}
          >
            <Pressable
              onPress={() => setSelectedSchoolId("")}
              style={({ pressed }) => [
                styles.schoolChip,
                nightMode && darkStyles.card,
                !selectedSchoolId && styles.schoolChipActive,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.schoolChipText,
                  nightMode && darkStyles.primaryText,
                  !selectedSchoolId && styles.schoolChipTextActive,
                ]}
              >
                All schools
              </Text>
            </Pressable>
            {schools.map((school) => (
              <Pressable
                key={school.id}
                onPress={() => setSelectedSchoolId(school.id)}
                style={({ pressed }) => [
                  styles.schoolChip,
                  nightMode && darkStyles.card,
                  selectedSchoolId === school.id && styles.schoolChipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.schoolChipText,
                    nightMode && darkStyles.primaryText,
                    selectedSchoolId === school.id &&
                      styles.schoolChipTextActive,
                  ]}
                >
                  {school.shortName || school.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <View style={styles.sectionTitleRow}>
          <View>
            <Text style={styles.eyebrow}>EXPLORE</Text>
            <Text
              style={[styles.sectionTitle, nightMode && darkStyles.primaryText]}
            >
              Browse categories
            </Text>
          </View>
          {selectedCategory && (
            <Pressable onPress={() => setSelectedCategory(null)}>
              <Text style={styles.link}>Clear</Text>
            </Pressable>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categories}
        >
          {categories.map((category) => {
            const active = selectedCategory === category.name;
            return (
              <Pressable
                key={category.id}
                onPress={() =>
                  setSelectedCategory(active ? null : category.name)
                }
                style={({ pressed }) => [
                  styles.category,
                  nightMode && darkStyles.card,
                  active && styles.categorySelected,
                  nightMode && active && darkStyles.selectedCard,
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[
                    styles.categoryIcon,
                    { backgroundColor: category.tint },
                    nightMode && styles.categoryIconDark,
                  ]}
                >
                  <Text
                    style={[styles.categoryIconText, { color: category.ink }]}
                  >
                    {category.icon}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.categoryName,
                    nightMode && darkStyles.primaryText,
                    active && styles.categoryNameSelected,
                  ]}
                >
                  {category.name}
                </Text>
                <Text
                  style={[
                    styles.categoryCount,
                    nightMode && darkStyles.mutedText,
                  ]}
                >
                  {category.serviceCount} services
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.sectionTitleRow}>
          <View>
            <Text style={styles.eyebrow}>MARKETPLACE</Text>
            <Text
              style={[styles.sectionTitle, nightMode && darkStyles.primaryText]}
            >
              {selectedCategory ?? "Available services"}
            </Text>
          </View>
        </View>
        {loading ? (
          <View style={[styles.emptyCard, nightMode && darkStyles.card]}>
            <ActivityIndicator color="#0F6B4F" />
            <Text
              style={[styles.emptyTitle, nightMode && darkStyles.primaryText]}
            >
              Connecting to CampusGig
            </Text>
            <Text style={[styles.emptyBody, nightMode && darkStyles.mutedText]}>
              Loading real marketplace data.
            </Text>
          </View>
        ) : services.length === 0 ? (
          <View style={[styles.emptyCard, nightMode && darkStyles.card]}>
            <View style={styles.emptyIcon}>
              <Text style={styles.emptyIconText}>◇</Text>
            </View>
            <Text
              style={[styles.emptyTitle, nightMode && darkStyles.primaryText]}
            >
              No services published yet
            </Text>
            <Text style={[styles.emptyBody, nightMode && darkStyles.mutedText]}>
              Verified provider services will appear here automatically.
            </Text>
            <Pressable
              onPress={onOpenProfile}
              style={({ pressed }) => [
                styles.providerButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.providerButtonText}>Become a provider</Text>
              <Text style={styles.providerArrow}>→</Text>
            </Pressable>
          </View>
        ) : (
          services.map((service) => (
            <Pressable
              onPress={() => onOpenService(service)}
              key={service.id}
              style={({ pressed }) => [
                styles.serviceCard,
                nightMode && darkStyles.card,
                pressed && styles.pressed,
              ]}
            >
              {service.coverMediaId ? (
                <Image
                  source={{
                    uri: `${API_URL}/api/v1/services/${service.id}/media/${service.coverMediaId}`,
                  }}
                  style={styles.serviceCover}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.serviceCoverFallback}>
                  <Text style={styles.serviceCoverFallbackText}>◇</Text>
                </View>
              )}
              <View style={styles.serviceCardBody}>
                <Text style={styles.serviceCategory}>{service.category}</Text>
                <Text
                  style={[
                    styles.serviceTitle,
                    nightMode && darkStyles.primaryText,
                  ]}
                >
                  {service.title}
                </Text>
                <View style={styles.serviceProviderRow}>
                  {service.providerHasAvatar ? (
                    <Image
                      source={{
                        uri: `${API_URL}/api/v1/profile/avatar/${service.providerId}?v=${service.providerAvatarVersion}`,
                      }}
                      style={styles.serviceProviderAvatar}
                    />
                  ) : (
                    <View style={styles.serviceProviderFallback}>
                      <Text style={styles.serviceProviderFallbackText}>
                        {service.provider.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text
                    style={[
                      styles.serviceMeta,
                      nightMode && darkStyles.mutedText,
                    ]}
                  >
                    {service.provider} · {service.school}
                  </Text>
                </View>
                <View
                  style={[
                    styles.serviceFooter,
                    nightMode && darkStyles.outline,
                  ]}
                >
                  <Text style={styles.serviceRating}>★ {service.rating}</Text>
                  <Text
                    style={[
                      styles.servicePrice,
                      nightMode && darkStyles.primaryText,
                    ]}
                  >
                    From ₱{service.price}
                  </Text>
                </View>
              </View>
            </Pressable>
          ))
        )}
        <View style={[styles.safetyCard, nightMode && darkStyles.card]}>
          <View style={styles.safetyIcon}>
            <Text>✓</Text>
          </View>
          <View style={styles.safetyCopy}>
            <Text style={styles.safetyTitle}>Built for campus trust</Text>
            <Text
              style={[styles.safetyBody, nightMode && darkStyles.mutedText]}
            >
              Student verification, order-based messaging, and clear project
              tracking.
            </Text>
          </View>
        </View>
      </ScrollView>
      <Modal
        visible={notificationsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNotificationsOpen(false)}
      >
        <Pressable
          style={styles.notificationModalBackdrop}
          onPress={() => setNotificationsOpen(false)}
        >
          <Pressable
            style={[
              styles.mobileNotificationSheet,
              nightMode && darkStyles.card,
            ]}
            onPress={() => undefined}
          >
            <View style={styles.mobileNotificationHead}>
              <View>
                <Text style={styles.eyebrow}>NOTIFICATIONS</Text>
                <Text
                  style={[
                    styles.mobileNotificationTitle,
                    nightMode && darkStyles.primaryText,
                  ]}
                >
                  Account activity
                </Text>
              </View>
              <Pressable onPress={() => setNotificationsOpen(false)}>
                <Text
                  style={[
                    styles.closeButtonText,
                    nightMode && darkStyles.primaryText,
                  ]}
                >
                  ×
                </Text>
              </Pressable>
            </View>
            {notifications.length ? (
              notifications.slice(0, 12).map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => void openNotification(item)}
                  style={[
                    styles.mobileNotificationRow,
                    nightMode && darkStyles.outline,
                  ]}
                >
                  <View
                    style={[
                      styles.mobileNotificationIcon,
                      !item.readAt && styles.mobileNotificationIconUnread,
                    ]}
                  >
                    <Text>
                      {item.type === "NEW_MESSAGE"
                        ? "✉"
                        : item.type === "ORDER_ACCEPTED"
                          ? "✓"
                          : "↗"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.mobileNotificationRowTitle,
                        nightMode && darkStyles.primaryText,
                      ]}
                    >
                      {item.title}
                    </Text>
                    <Text
                      style={[
                        styles.mobileNotificationRowBody,
                        nightMode && darkStyles.mutedText,
                      ]}
                    >
                      {item.body}
                    </Text>
                    <Text
                      style={[
                        styles.mobileNotificationRowTime,
                        nightMode && darkStyles.mutedText,
                      ]}
                    >
                      {new Date(item.createdAt).toLocaleString()}
                    </Text>
                  </View>
                  {!item.readAt && <View style={styles.mobileUnreadDot} />}
                </Pressable>
              ))
            ) : (
              <View style={styles.mobileNotificationEmpty}>
                <Text
                  style={[
                    styles.emptyTitle,
                    nightMode && darkStyles.primaryText,
                  ]}
                >
                  No notifications yet
                </Text>
                <Text
                  style={[styles.emptyBody, nightMode && darkStyles.mutedText]}
                >
                  Order updates and messages will appear here.
                </Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
