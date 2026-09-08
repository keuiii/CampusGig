import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL, STORAGE_KEYS } from "../../config";
import { darkStyles, green, styles } from "../../theme";
import type {
  DisputeReason,
  MobileOrder,
  MobileOrderDetail,
  OrderDispute,
  OrderFile,
  OrderHistoryItem,
} from "../../types";

const TOKEN_KEY = STORAGE_KEYS.accessToken;
const DOWNLOAD_DIRECTORY_KEY = STORAGE_KEYS.downloadDirectory;

export function OrderWorkspaceModal({
  nightMode,
  order,
  onClose,
}: {
  nightMode: boolean;
  order: MobileOrder | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<MobileOrderDetail | null>(null);
  const [history, setHistory] = useState<OrderHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [revisionInstructions, setRevisionInstructions] = useState("");
  const [rating, setRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [acting, setActing] = useState(false);
  const [dispute, setDispute] = useState<OrderDispute | null>(null);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState<DisputeReason>("SERVICE_NOT_DELIVERED");
  const [disputeDetails, setDisputeDetails] = useState("");
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(
    null,
  );

  async function loadWorkspace(showLoading = false) {
    if (!order) return;
    if (showLoading) setLoading(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const headers = { Authorization: `Bearer ${token}` };
      const detailResponse = await fetch(
        `${API_URL}/api/v1/orders/${order.id}`,
        { headers },
      );
      if (detailResponse.ok) {
        const next = (await detailResponse.json()).data as MobileOrderDetail;
        setDetail(next);
        setHistory(next.history ?? []);
      }
      const disputeResponse = await fetch(`${API_URL}/api/v1/orders/${order.id}/disputes`, { headers });
      if (disputeResponse.ok) setDispute((await disputeResponse.json()).data as OrderDispute | null);
    } finally {
      if (showLoading) setLoading(false);
    }
  }
  useEffect(() => {
    if (!order) return;
    setDetail(null);
    setHistory([]);
    setRevisionInstructions("");
    setReviewComment("");
    setDispute(null);
    setShowDisputeForm(false);
    setDisputeDetails("");
    setRating(5);
    void loadWorkspace(true);
    const timer = setInterval(() => void loadWorkspace(), 5000);
    return () => clearInterval(timer);
  }, [order?.id]);
  async function orderAction(path: string, body?: object) {
    if (!order || acting) return;
    setActing(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(
        `${API_URL}/api/v1/orders/${order.id}/${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          Array.isArray(payload?.message)
            ? payload.message.join(" ")
            : (payload?.message ?? "Unable to update order"),
        );
      Alert.alert("Order updated", payload.message);
      setRevisionInstructions("");
      await loadWorkspace();
    } catch (error) {
      Alert.alert(
        "Unable to continue",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setActing(false);
    }
  }
  async function confirmDispute() {
    if (!order || submittingDispute || disputeDetails.trim().length < 10) return;
    Alert.alert(
      "Submit order report?",
      "CampusGig administrators will review your report and the order activity.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Submit", onPress: () => void submitDispute() },
      ],
    );
  }
  async function submitDispute() {
    if (!order) return;
    setSubmittingDispute(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/orders/${order.id}/disputes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: disputeReason, details: disputeDetails.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join(" ") : (payload?.message ?? "Unable to submit report"));
      setDispute(payload.data as OrderDispute);
      setShowDisputeForm(false);
      setDisputeDetails("");
      Alert.alert("Report submitted", payload.message);
    } catch (error) {
      Alert.alert("Unable to submit report", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSubmittingDispute(false);
    }
  }
  async function openDelivery(
    file: Pick<OrderFile, "id" | "originalName" | "mimeType">,
  ) {
    if (!order || downloadingFileId) return;
    setDownloadingFileId(file.id);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const safeName = file.originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const temporaryPath = `${FileSystem.cacheDirectory}campusgig-${file.id}-${safeName}`;
      const result = await FileSystem.downloadAsync(
        `${API_URL}/api/v1/orders/${order.id}/files/${file.id}`,
        temporaryPath,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (result.status < 200 || result.status >= 300)
        throw new Error("The file could not be downloaded");
      if (Platform.OS === "android") {
        let directoryUri = await AsyncStorage.getItem(DOWNLOAD_DIRECTORY_KEY);
        if (!directoryUri) {
          const permission =
            await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
          if (!permission.granted) {
            Alert.alert(
              "Download cancelled",
              "Choose the Downloads folder so CampusGig can save this delivery.",
            );
            return;
          }
          directoryUri = permission.directoryUri;
          await AsyncStorage.setItem(DOWNLOAD_DIRECTORY_KEY, directoryUri);
        }
        try {
          const savedUri =
            await FileSystem.StorageAccessFramework.createFileAsync(
              directoryUri,
              safeName,
              file.mimeType,
            );
          const base64 = await FileSystem.readAsStringAsync(result.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          await FileSystem.writeAsStringAsync(savedUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          Alert.alert(
            "Download complete",
            `${file.originalName} was saved to your selected Downloads folder. You can open it there before accepting or requesting a revision.`,
          );
        } catch {
          await AsyncStorage.removeItem(DOWNLOAD_DIRECTORY_KEY);
          throw new Error(
            "CampusGig could not access the selected folder. Tap the file again and choose Downloads.",
          );
        }
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          dialogTitle: `Save or open ${file.originalName}`,
          mimeType: file.mimeType,
        });
      } else Alert.alert("File downloaded", result.uri);
    } catch (error) {
      Alert.alert(
        "Unable to download file",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setDownloadingFileId(null);
    }
  }
  const status = detail?.status ?? order?.status ?? "";
  const statusGuidance =
    status === "REQUESTED"
      ? "Waiting for the provider to review your request."
      : status === "ACCEPTED"
        ? "Your request was accepted and will begin soon."
        : status === "IN_PROGRESS"
          ? "The provider is currently working on your project."
          : status === "SUBMITTED"
            ? "Your delivery is ready for review."
            : status === "REVISION_REQUESTED"
              ? "Your revision request was sent to the provider."
              : status === "COMPLETED"
                ? "This project has been successfully completed."
                : "Follow the latest activity in the timeline below.";
  return (
    <Modal
      visible={Boolean(order)}
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={[styles.workspaceSafe, nightMode && darkStyles.surface]}
      >
        <StatusBar style={nightMode ? "light" : "dark"} />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={[styles.workspaceHeader, nightMode && darkStyles.outline]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>ORDER WORKSPACE</Text>
              <Text
                style={[
                  styles.workspaceTitle,
                  nightMode && darkStyles.primaryText,
                ]}
                numberOfLines={1}
              >
                {order?.title}
              </Text>
              <View style={styles.workspaceHeaderMeta}>
                <Text
                  style={[
                    styles.workspaceOrderNumber,
                    nightMode && darkStyles.mutedText,
                  ]}
                >
                  {order?.orderNumber}
                </Text>
                <View style={styles.workspaceStatusPill}>
                  <Text style={styles.workspaceStatusPillText}>
                    {status.replaceAll("_", " ")}
                  </Text>
                </View>
              </View>
            </View>
            <Pressable
              onPress={onClose}
              style={[styles.closeButton, nightMode && darkStyles.card]}
            >
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
          {loading ? (
            <ActivityIndicator color={green} style={{ marginTop: 50 }} />
          ) : (
            <ScrollView
              contentContainerStyle={styles.workspaceContent}
              keyboardShouldPersistTaps="handled"
            >
              <View
                style={[styles.workspaceSummary, nightMode && darkStyles.card]}
              >
                <Text style={styles.workspaceCardEyebrow}>PROJECT BRIEF</Text>
                <Text
                  style={[
                    styles.workspaceSectionTitle,
                    nightMode && darkStyles.primaryText,
                  ]}
                >
                  What you asked for
                </Text>
                <Text
                  style={[
                    styles.workspaceBody,
                    nightMode && darkStyles.mutedText,
                  ]}
                >
                  {order?.requirements}
                </Text>
                <View style={styles.workspaceFacts}>
                  <Text
                    style={[
                      styles.workspaceFact,
                      nightMode && darkStyles.primaryText,
                    ]}
                  >
                    ₱{((order?.totalCentavos ?? 0) / 100).toLocaleString()}
                  </Text>
                  <Text
                    style={[
                      styles.workspaceFact,
                      nightMode && darkStyles.primaryText,
                    ]}
                  >
                    {order?.package.name}
                  </Text>
                  <Text
                    style={[
                      styles.workspaceFact,
                      nightMode && darkStyles.primaryText,
                    ]}
                  >
                    Revisions {detail?.revisionsUsed ?? 0}/
                    {detail?.revisionLimit ?? order?.package.revisionLimit ?? 0}
                  </Text>
                </View>
              </View>
              <View
                style={[
                  styles.workspaceProgressBanner,
                  nightMode && darkStyles.card,
                ]}
              >
                <View style={styles.workspaceProgressIcon}>
                  <Text style={styles.workspaceProgressIconText}>
                    {status === "COMPLETED"
                      ? "✓"
                      : status === "SUBMITTED"
                        ? "⇩"
                        : "↗"}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.workspaceProgressTitle,
                      nightMode && darkStyles.primaryText,
                    ]}
                  >
                    {status.replaceAll("_", " ")}
                  </Text>
                  <Text
                    style={[
                      styles.workspaceProgressBody,
                      nightMode && darkStyles.mutedText,
                    ]}
                  >
                    {statusGuidance}
                  </Text>
                </View>
              </View>
              {detail?.files?.length ? (
                <>
                  <Text style={styles.groupLabel}>PROJECT DELIVERABLES</Text>
                  <View
                    style={[styles.timelineCard, nightMode && darkStyles.card]}
                  >
                    {detail.files.map((file) => (
                      <Pressable
                        disabled={Boolean(downloadingFileId)}
                        onPress={() => void openDelivery(file)}
                        key={file.id}
                        style={({ pressed }) => [
                          styles.deliveryFileRow,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.deliveryFileIcon}>
                          {downloadingFileId === file.id ? (
                            <ActivityIndicator size="small" color={green} />
                          ) : (
                            <Text>⇩</Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.timelineStatus,
                              nightMode && darkStyles.primaryText,
                            ]}
                          >
                            {file.originalName}
                          </Text>
                          <Text
                            style={[
                              styles.timelineNote,
                              nightMode && darkStyles.mutedText,
                            ]}
                          >
                            {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB · Tap
                            to open · {file.purpose.replaceAll("_", " ")}
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}
              {status === "SUBMITTED" && (
                <>
                  <Text style={styles.groupLabel}>REVIEW THIS DELIVERY</Text>
                  <View
                    style={[
                      styles.clientDecisionCard,
                      nightMode && darkStyles.card,
                    ]}
                  >
                    <Text
                      style={[
                        styles.workspaceSectionTitle,
                        nightMode && darkStyles.primaryText,
                      ]}
                    >
                      Is the work ready?
                    </Text>
                    <Text
                      style={[
                        styles.workspaceBody,
                        nightMode && darkStyles.mutedText,
                      ]}
                    >
                      Accept the delivery to complete the order, or send clear
                      revision instructions.
                    </Text>
                    <Pressable
                      disabled={acting}
                      onPress={() => void orderAction("complete")}
                      style={styles.acceptDeliveryButton}
                    >
                      <Text style={styles.authButtonText}>
                        ✓ Accept delivery
                      </Text>
                    </Pressable>
                    {(detail?.revisionsUsed ?? 0) <
                      (detail?.revisionLimit ?? 0) && (
                      <>
                        <TextInput
                          value={revisionInstructions}
                          onChangeText={setRevisionInstructions}
                          multiline
                          maxLength={2000}
                          placeholder="Describe exactly what needs to be changed…"
                          placeholderTextColor="#929A96"
                          style={[
                            styles.revisionInput,
                            nightMode && darkStyles.input,
                            nightMode && darkStyles.primaryText,
                          ]}
                        />
                        <Pressable
                          disabled={
                            acting || revisionInstructions.trim().length < 10
                          }
                          onPress={() =>
                            void orderAction("revision", {
                              instructions: revisionInstructions.trim(),
                            })
                          }
                          style={[
                            styles.revisionButton,
                            (acting ||
                              revisionInstructions.trim().length < 10) &&
                              styles.authButtonDisabled,
                          ]}
                        >
                          <Text style={styles.revisionButtonText}>
                            Request revision
                          </Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                </>
              )}
              {status === "COMPLETED" && !detail?.review && (
                <>
                  <Text style={styles.groupLabel}>RATE YOUR PROVIDER</Text>
                  <View
                    style={[
                      styles.clientDecisionCard,
                      nightMode && darkStyles.card,
                    ]}
                  >
                    <View style={styles.ratingRow}>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <Pressable key={value} onPress={() => setRating(value)}>
                          <Text
                            style={[
                              styles.ratingStar,
                              value <= rating && styles.ratingStarActive,
                            ]}
                          >
                            ★
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <TextInput
                      value={reviewComment}
                      onChangeText={setReviewComment}
                      multiline
                      maxLength={1000}
                      placeholder="Share your experience (optional)…"
                      placeholderTextColor="#929A96"
                      style={[
                        styles.revisionInput,
                        nightMode && darkStyles.input,
                        nightMode && darkStyles.primaryText,
                      ]}
                    />
                    <Pressable
                      disabled={acting}
                      onPress={() =>
                        void orderAction("review", {
                          overallRating: rating,
                          qualityRating: rating,
                          communicationRating: rating,
                          timelinessRating: rating,
                          comment: reviewComment.trim() || undefined,
                        })
                      }
                      style={styles.acceptDeliveryButton}
                    >
                      <Text style={styles.authButtonText}>
                        Submit {rating}-star review
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
              {detail?.review && (
                <View
                  style={[styles.reviewComplete, nightMode && darkStyles.card]}
                >
                  <Text style={styles.ratingStarActive}>
                    {"★".repeat(detail.review.overallRating)}
                  </Text>
                  <Text
                    style={[
                      styles.workspaceBody,
                      nightMode && darkStyles.mutedText,
                    ]}
                  >
                    Your review has been submitted. {detail.review.comment}
                  </Text>
                </View>
              )}
              {["ACCEPTED", "IN_PROGRESS", "SUBMITTED", "REVISION_REQUESTED", "COMPLETED"].includes(status) && (
                <>
                  <Text style={styles.groupLabel}>SUPPORT & SAFETY</Text>
                  <View style={[styles.clientDecisionCard, nightMode && darkStyles.card]}>
                    {dispute ? (
                      <>
                        <View style={styles.workspaceSectionHeading}>
                          <Text style={[styles.workspaceSectionTitle, nightMode && darkStyles.primaryText]}>Report status</Text>
                          <View style={styles.workspaceStatusPill}><Text style={styles.workspaceStatusPillText}>{dispute.status.replaceAll("_", " ")}</Text></View>
                        </View>
                        <Text style={styles.workspaceCardEyebrow}>{dispute.reason.replaceAll("_", " ")}</Text>
                        <Text style={[styles.workspaceBody, nightMode && darkStyles.mutedText]}>{dispute.details}</Text>
                        {dispute.resolutionNote ? <Text style={[styles.workspaceBody, nightMode && darkStyles.primaryText]}>Resolution: {dispute.resolutionNote}</Text> : null}
                      </>
                    ) : showDisputeForm ? (
                      <>
                        <Text style={[styles.workspaceSectionTitle, nightMode && darkStyles.primaryText]}>Report an order problem</Text>
                        <Text style={[styles.workspaceBody, nightMode && darkStyles.mutedText]}>Choose the closest reason and provide specific details.</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                          {(["SERVICE_NOT_DELIVERED", "QUALITY_ISSUE", "REQUIREMENTS_MISMATCH", "PAYMENT_ISSUE", "CONDUCT", "OTHER"] as DisputeReason[]).map((reason) => (
                            <Pressable key={reason} onPress={() => setDisputeReason(reason)} style={[styles.disputeReasonChip, disputeReason === reason && styles.disputeReasonChipActive]}>
                              <Text style={[styles.disputeReasonChipText, disputeReason === reason && styles.authButtonText]}>{reason.replaceAll("_", " ")}</Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                        <TextInput value={disputeDetails} onChangeText={setDisputeDetails} multiline maxLength={2000} placeholder="Describe what happened…" placeholderTextColor="#929A96" style={[styles.revisionInput, nightMode && darkStyles.input, nightMode && darkStyles.primaryText]} />
                        <View style={styles.disputeActions}>
                          <Pressable onPress={() => setShowDisputeForm(false)} style={styles.revisionButton}><Text style={styles.revisionButtonText}>Cancel</Text></Pressable>
                          <Pressable disabled={submittingDispute || disputeDetails.trim().length < 10} onPress={() => void confirmDispute()} style={[styles.acceptDeliveryButton, (submittingDispute || disputeDetails.trim().length < 10) && styles.authButtonDisabled]}>
                            {submittingDispute ? <ActivityIndicator color="#fff" /> : <Text style={styles.authButtonText}>Submit report</Text>}
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={[styles.workspaceSectionTitle, nightMode && darkStyles.primaryText]}>Need help with this order?</Text>
                        <Text style={[styles.workspaceBody, nightMode && darkStyles.mutedText]}>Report delivery, quality, payment, or conduct problems for administrator review.</Text>
                        <Pressable onPress={() => setShowDisputeForm(true)} style={styles.revisionButton}><Text style={styles.revisionButtonText}>Report a problem</Text></Pressable>
                      </>
                    )}
                  </View>
                </>
              )}
              <View style={styles.workspaceSectionHeading}>
                <View>
                  <Text style={styles.groupLabel}>ORDER TIMELINE</Text>
                  <Text
                    style={[
                      styles.workspaceSectionHelp,
                      nightMode && darkStyles.mutedText,
                    ]}
                  >
                    Every project update is recorded here.
                  </Text>
                </View>
                <Text style={styles.workspaceTimelineCount}>
                  {history.length}
                </Text>
              </View>
              <View style={[styles.timelineCard, nightMode && darkStyles.card]}>
                {history.map((item, index) => (
                  <View key={item.id} style={styles.timelineRow}>
                    <View style={styles.timelineRail}>
                      <View style={styles.timelineDot} />
                      {index < history.length - 1 && (
                        <View
                          style={[
                            styles.timelineLine,
                            nightMode && darkStyles.outline,
                          ]}
                        />
                      )}
                    </View>
                    <View style={styles.timelineCopy}>
                      <Text
                        style={[
                          styles.timelineStatus,
                          nightMode && darkStyles.primaryText,
                        ]}
                      >
                        {item.toStatus.replaceAll("_", " ")}
                      </Text>
                      <Text
                        style={[
                          styles.timelineNote,
                          nightMode && darkStyles.mutedText,
                        ]}
                      >
                        {item.note} · {item.actor.displayName}
                      </Text>
                      <Text
                        style={[
                          styles.timelineDate,
                          nightMode && darkStyles.mutedText,
                        ]}
                      >
                        {new Date(item.createdAt).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
