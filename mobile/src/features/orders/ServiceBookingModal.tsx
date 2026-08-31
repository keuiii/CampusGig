import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { API_URL, STORAGE_KEYS } from "../../config";
import { styles } from "../../theme";
import type { Service } from "../../types";

const TOKEN_KEY = STORAGE_KEYS.accessToken;

export function ServiceBookingModal({
  service,
  onClose,
  onCreated,
}: {
  service: Service | null;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [packageId, setPackageId] = useState("");
  const [requirements, setRequirements] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setPackageId(service?.packages[0]?.id ?? "");
    setRequirements("");
  }, [service?.id]);
  const selectedPackage =
    service?.packages.find((item) => item.id === packageId) ??
    service?.packages[0];

  async function createOrder() {
    if (!service || !selectedPackage) return;
    if (requirements.trim().length < 10)
      return Alert.alert(
        "Add your requirements",
        "Tell the provider what you need using at least 10 characters.",
      );
    setSubmitting(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          serviceId: service.id,
          servicePackageId: selectedPackage.id,
          requirements: requirements.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          Array.isArray(payload?.message)
            ? payload.message.join("\n")
            : (payload?.message ?? "Unable to create your order."),
        );
      Alert.alert(
        "Request sent",
        `${payload.data.orderNumber} was created. ${payload.message}`,
      );
      await onCreated();
    } catch (error) {
      Alert.alert(
        "Booking failed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible={Boolean(service)}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.bookingSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.bookingHeader}>
            <View style={styles.bookingHeaderCopy}>
              <Text style={styles.serviceCategory}>{service?.category}</Text>
              <Text style={styles.bookingTitle}>{service?.title}</Text>
              <Text style={styles.serviceMeta}>
                {service?.provider} · {service?.school}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.bookingContent}
          >
            {service?.coverMediaId ? (
              <Image
                source={{
                  uri: `${API_URL}/api/v1/services/${service.id}/media/${service.coverMediaId}`,
                }}
                style={styles.bookingCover}
              />
            ) : null}
            <Text style={styles.bookingDescription}>
              {service?.description}
            </Text>
            <Text style={styles.groupLabel}>CHOOSE A PACKAGE</Text>
            {service?.packages.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => setPackageId(item.id)}
                style={[
                  styles.packageChoice,
                  packageId === item.id && styles.packageChoiceActive,
                ]}
              >
                <View style={styles.packageChoiceTop}>
                  <View>
                    <Text style={styles.packageTier}>{item.tier}</Text>
                    <Text style={styles.packageName}>{item.name}</Text>
                  </View>
                  <Text style={styles.packagePrice}>
                    ₱{(item.priceCentavos / 100).toLocaleString()}
                  </Text>
                </View>
                <Text style={styles.packageDescription}>
                  {item.description}
                </Text>
                <Text style={styles.packageMeta}>
                  {item.deliveryDays} day delivery · {item.revisionLimit}{" "}
                  revision{item.revisionLimit === 1 ? "" : "s"}
                </Text>
              </Pressable>
            ))}
            <Text style={styles.groupLabel}>PROJECT REQUIREMENTS</Text>
            <TextInput
              value={requirements}
              onChangeText={setRequirements}
              multiline
              maxLength={3000}
              placeholder="Describe exactly what you need, preferred style, dimensions, deadline details, and references…"
              placeholderTextColor="#929A96"
              style={styles.requirementsInput}
            />
            <Text style={styles.requirementsCount}>
              {requirements.trim().length}/3000 · minimum 10 characters
            </Text>
            <View style={styles.bookingSummary}>
              <View>
                <Text style={styles.summaryLabel}>TOTAL FOR THIS REQUEST</Text>
                <Text style={styles.summaryHelp}>
                  Payment will be connected through PayMongo later.
                </Text>
              </View>
              <Text style={styles.summaryPrice}>
                ₱
                {((selectedPackage?.priceCentavos ?? 0) / 100).toLocaleString()}
              </Text>
            </View>
            <Pressable
              disabled={
                submitting ||
                !selectedPackage ||
                requirements.trim().length < 10
              }
              onPress={createOrder}
              style={({ pressed }) => [
                styles.authButton,
                (submitting ||
                  !selectedPackage ||
                  requirements.trim().length < 10) &&
                  styles.authButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Text style={styles.authButtonText}>
                    Send service request
                  </Text>
                  <Text style={styles.authButtonArrow}>→</Text>
                </>
              )}
            </Pressable>
            <Text style={styles.providerNotice}>
              The provider will receive an in-app notification immediately.
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
