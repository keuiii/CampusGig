import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { darkStyles, green, styles } from "../theme";
import type { MobileOrder } from "../types";

export function OrdersScreen({
  nightMode,
  orders,
  loading,
  onRefresh,
  onBrowse,
  onOpen,
}: {
  nightMode: boolean;
  orders: MobileOrder[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onBrowse: () => void;
  onOpen: (order: MobileOrder) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }
  return (
    <ScrollView
      style={[styles.screen, nightMode && darkStyles.surface]}
      contentContainerStyle={styles.standardContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          colors={[green]}
          tintColor={nightMode ? "#D9F36A" : green}
        />
      }
    >
      <Text style={styles.eyebrow}>MY PROJECTS</Text>
      <Text style={[styles.pageTitle, nightMode && darkStyles.primaryText]}>
        Orders
      </Text>
      <Text style={[styles.ordersIntro, nightMode && darkStyles.mutedText]}>
        Track every service request from confirmation to completion.
      </Text>
      {loading && !orders.length ? (
        <ActivityIndicator color={green} style={{ marginTop: 45 }} />
      ) : orders.length ? (
        orders.map((order) => (
          <Pressable
            onPress={() => onOpen(order)}
            key={order.id}
            style={({ pressed }) => [
              styles.orderCard,
              nightMode && darkStyles.card,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.orderTop}>
              <Text
                style={[styles.orderNumber, nightMode && darkStyles.mutedText]}
              >
                {order.orderNumber}
              </Text>
              <View style={styles.orderStatus}>
                <Text style={styles.orderStatusText}>
                  {order.status.replaceAll("_", " ")}
                </Text>
              </View>
            </View>
            <Text
              style={[styles.orderTitle, nightMode && darkStyles.primaryText]}
            >
              {order.title}
            </Text>
            <Text
              style={[styles.orderProvider, nightMode && darkStyles.mutedText]}
            >
              Provider · {order.provider.displayName}
            </Text>
            <View
              style={[styles.orderMetaRow, nightMode && darkStyles.outline]}
            >
              <View>
                <Text style={styles.orderMetaLabel}>PACKAGE</Text>
                <Text
                  style={[
                    styles.orderMetaValue,
                    nightMode && darkStyles.primaryText,
                  ]}
                >
                  {order.package.name}
                </Text>
              </View>
              <View>
                <Text style={styles.orderMetaLabel}>TOTAL</Text>
                <Text
                  style={[
                    styles.orderMetaValue,
                    nightMode && darkStyles.primaryText,
                  ]}
                >
                  ₱{(order.totalCentavos / 100).toLocaleString()}
                </Text>
              </View>
              <View>
                <Text style={styles.orderMetaLabel}>DUE</Text>
                <Text
                  style={[
                    styles.orderMetaValue,
                    nightMode && darkStyles.primaryText,
                  ]}
                >
                  {new Date(order.dueAt).toLocaleDateString()}
                </Text>
              </View>
            </View>
            <Text style={styles.openWorkspaceText}>Open order workspace →</Text>
          </Pressable>
        ))
      ) : (
        <View style={styles.largeEmpty}>
          <View style={styles.largeEmptyIcon}>
            <Text style={styles.largeEmptyIconText}>◇</Text>
          </View>
          <Text
            style={[styles.emptyTitle, nightMode && darkStyles.primaryText]}
          >
            No orders yet
          </Text>
          <Text style={[styles.emptyBody, nightMode && darkStyles.mutedText]}>
            Choose a published student service and send your first project
            request.
          </Text>
          <Pressable style={styles.primaryButton} onPress={onBrowse}>
            <Text style={styles.primaryButtonText}>Browse services</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
