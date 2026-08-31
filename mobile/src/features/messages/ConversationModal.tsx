import { Fragment, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { StatusBar } from "expo-status-bar";
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
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL, STORAGE_KEYS } from "../../config";
import { darkStyles, green, styles } from "../../theme";
import type {
  ConversationInboxItem,
  MessageAttachment,
  OrderMessage,
} from "../../types";

const TOKEN_KEY = STORAGE_KEYS.accessToken;
const DOWNLOAD_DIRECTORY_KEY = STORAGE_KEYS.downloadDirectory;

function messageDateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const day = date.toDateString();
  const dayLabel =
    day === today.toDateString()
      ? "Today"
      : day === yesterday.toDateString()
        ? "Yesterday"
        : date.toLocaleDateString([], {
            month: "short",
            day: "numeric",
            year:
              date.getFullYear() === today.getFullYear()
                ? undefined
                : "numeric",
          });

  return `${dayLabel} at ${date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function ConversationModal({
  nightMode,
  conversation,
  onClose,
}: {
  nightMode: boolean;
  conversation: ConversationInboxItem | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const listRef = useRef<ScrollView>(null);
  async function load(showLoading = false) {
    if (!conversation) return;
    if (showLoading) setLoading(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(
        `${API_URL}/api/v1/orders/${conversation.order.id}/messages`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.ok) setMessages((await response.json()).data ?? []);
    } finally {
      if (showLoading) setLoading(false);
    }
  }
  useEffect(() => {
    if (!conversation) return;
    setMessages([]);
    setDraft("");
    setFiles([]);
    void load(true);
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [conversation?.id]);
  async function chooseFiles() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
        "application/zip",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled) return;
    const selected = result.assets.slice(0, 3);
    if (selected.some((file) => (file.size ?? 0) > 15 * 1024 * 1024))
      return Alert.alert(
        "File is too large",
        "Each attachment must be 15 MB or smaller.",
      );
    setFiles(selected);
  }
  async function send() {
    const body = draft.trim();
    if (!conversation || (!body && !files.length) || sending) return;
    setSending(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      let response: Response;
      if (files.length) {
        const form = new FormData();
        if (body) form.append("body", body);
        files.forEach((file) =>
          form.append("files", {
            uri: file.uri,
            name: file.name,
            type: file.mimeType ?? "application/octet-stream",
          } as unknown as Blob),
        );
        response = await fetch(
          `${API_URL}/api/v1/orders/${conversation.order.id}/messages/attachments`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          },
        );
      } else
        response = await fetch(
          `${API_URL}/api/v1/orders/${conversation.order.id}/messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ body }),
          },
        );
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.message ?? "Unable to send message");
      setMessages((items) => [...items, payload.data]);
      setDraft("");
      setFiles([]);
    } catch (error) {
      Alert.alert(
        "Message not sent",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSending(false);
    }
  }
  async function download(file: MessageAttachment) {
    if (!conversation || downloading) return;
    setDownloading(file.id);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const safeName = file.originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const temporaryPath = `${FileSystem.cacheDirectory}campusgig-${file.id}-${safeName}`;
      const result = await FileSystem.downloadAsync(
        `${API_URL}/api/v1/orders/${conversation.order.id}/files/${file.id}`,
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
              "Choose the Downloads folder so CampusGig can save this attachment.",
            );
            return;
          }
          directoryUri = permission.directoryUri;
          await AsyncStorage.setItem(DOWNLOAD_DIRECTORY_KEY, directoryUri);
        }
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
          `${file.originalName} was saved to your selected Downloads folder.`,
        );
      } else if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(result.uri, {
          dialogTitle: `Save or open ${file.originalName}`,
          mimeType: file.mimeType,
        });
    } catch (error) {
      Alert.alert(
        "Unable to download file",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setDownloading(null);
    }
  }
  return (
    <Modal
      visible={Boolean(conversation)}
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={[styles.conversationScreen, nightMode && darkStyles.surface]}
      >
        <StatusBar style={nightMode ? "light" : "dark"} />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={[
              styles.conversationHeader,
              nightMode && darkStyles.navigation,
            ]}
          >
            <Pressable onPress={onClose} style={styles.conversationBack}>
              <Text
                style={[
                  styles.conversationBackText,
                  nightMode && darkStyles.primaryText,
                ]}
              >
                ‹
              </Text>
            </Pressable>
            {conversation?.participant.hasAvatar ? (
              <Image
                source={{
                  uri: `${API_URL}/api/v1/profile/avatar/${conversation.participant.id}?v=${conversation.participant.avatarVersion}`,
                }}
                style={styles.conversationHeaderAvatar}
              />
            ) : (
              <View style={styles.conversationHeaderAvatarFallback}>
                <Text style={styles.conversationAvatarText}>
                  {conversation?.participant.displayName
                    .charAt(0)
                    .toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={[
                  styles.conversationHeaderName,
                  nightMode && darkStyles.primaryText,
                ]}
              >
                {conversation?.participant.displayName}
              </Text>
              <Text
                style={[
                  styles.conversationHeaderMeta,
                  nightMode && darkStyles.mutedText,
                ]}
              >
                ● Private conversation
              </Text>
            </View>
          </View>
          {loading ? (
            <ActivityIndicator color={green} style={{ marginTop: 60 }} />
          ) : (
            <ScrollView
              ref={listRef}
              style={styles.conversationMessageList}
              contentContainerStyle={styles.conversationMessageContent}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() =>
                listRef.current?.scrollToEnd({ animated: false })
              }
            >
              {messages.length ? (
                messages.map((message, index) => {
                  const previousMessage = messages[index - 1];
                  const startsNewDay =
                    !previousMessage ||
                    new Date(previousMessage.createdAt).toDateString() !==
                      new Date(message.createdAt).toDateString();

                  return (
                    <Fragment key={message.id}>
                      {startsNewDay && (
                        <View style={styles.messageDateSeparator}>
                          <Text
                            style={[
                              styles.messageDateSeparatorText,
                              nightMode && darkStyles.mutedText,
                            ]}
                          >
                            {messageDateLabel(message.createdAt)}
                          </Text>
                        </View>
                      )}
                      <View
                        style={[
                          styles.messageRow,
                          message.isMine && styles.messageRowMine,
                        ]}
                      >
                        {!message.isMine &&
                          (message.sender.hasAvatar ? (
                            <Image
                              source={{
                                uri: `${API_URL}/api/v1/profile/avatar/${message.sender.id}?v=${message.sender.avatarVersion}`,
                              }}
                              style={styles.messageAvatarImage}
                            />
                          ) : (
                            <View style={styles.messageAvatar}>
                              <Text style={styles.messageAvatarText}>
                                {message.sender.displayName
                                  .charAt(0)
                                  .toUpperCase()}
                              </Text>
                            </View>
                          ))}
                        <View
                          style={[
                            styles.messageBubble,
                            message.isMine
                              ? styles.messageBubbleMine
                              : nightMode
                                ? darkStyles.input
                                : styles.messageBubbleOther,
                          ]}
                        >
                          <Text
                            style={[
                              styles.messageSender,
                              message.isMine && styles.messageSenderMine,
                            ]}
                          >
                            {message.isMine
                              ? "You"
                              : message.sender.displayName}
                          </Text>
                          {message.body && (
                            <Text
                              style={[
                                styles.messageBody,
                                message.isMine && styles.messageBodyMine,
                                nightMode &&
                                  !message.isMine &&
                                  darkStyles.primaryText,
                              ]}
                            >
                              {message.body}
                            </Text>
                          )}
                          {message.attachments?.map((file) => (
                            <Pressable
                              key={file.id}
                              onPress={() => void download(file)}
                              style={styles.mobileChatAttachment}
                            >
                              <Text
                                style={[
                                  styles.mobileChatAttachmentName,
                                  message.isMine && styles.messageBodyMine,
                                ]}
                              >
                                {downloading === file.id
                                  ? "Downloading…"
                                  : `⇩ ${file.originalName}`}
                              </Text>
                              <Text
                                style={[
                                  styles.mobileChatAttachmentMeta,
                                  message.isMine && styles.messageTimeMine,
                                ]}
                              >
                                {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB ·
                                Tap to download
                              </Text>
                            </Pressable>
                          ))}
                          <Text
                            style={[
                              styles.messageTime,
                              message.isMine && styles.messageTimeMine,
                            ]}
                          >
                            {new Date(message.createdAt).toLocaleTimeString(
                              [],
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </Text>
                        </View>
                        {message.isMine &&
                          (message.sender.hasAvatar ? (
                            <Image
                              source={{
                                uri: `${API_URL}/api/v1/profile/avatar/${message.sender.id}?v=${message.sender.avatarVersion}`,
                              }}
                              style={[
                                styles.messageAvatarImage,
                                styles.messageAvatarImageMine,
                              ]}
                            />
                          ) : (
                            <View
                              style={[
                                styles.messageAvatar,
                                styles.messageAvatarMine,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.messageAvatarText,
                                  styles.messageAvatarTextMine,
                                ]}
                              >
                                {message.sender.displayName
                                  .charAt(0)
                                  .toUpperCase()}
                              </Text>
                            </View>
                          ))}
                      </View>
                    </Fragment>
                  );
                })
              ) : (
                <View style={styles.conversationEmpty}>
                  <View style={styles.messageEmptyIcon}>
                    <Text>✉</Text>
                  </View>
                  <Text
                    style={[
                      styles.messageEmptyTitle,
                      nightMode && darkStyles.primaryText,
                    ]}
                  >
                    Start the conversation
                  </Text>
                  <Text
                    style={[
                      styles.messageEmpty,
                      nightMode && darkStyles.mutedText,
                    ]}
                  >
                    Send a message or reference file about your project.
                  </Text>
                </View>
              )}
            </ScrollView>
          )}
          <View
            style={[
              styles.conversationComposerArea,
              nightMode && darkStyles.navigation,
            ]}
          >
            {files.length > 0 && (
              <View style={styles.mobileFilePreview}>
                <Text numberOfLines={1} style={styles.mobileFilePreviewText}>
                  {files.map((file) => file.name).join(" · ")}
                </Text>
                <Pressable onPress={() => setFiles([])}>
                  <Text style={styles.mobileFilePreviewClear}>Clear</Text>
                </Pressable>
              </View>
            )}
            <View style={[styles.composer, nightMode && darkStyles.navigation]}>
              <Pressable
                onPress={() => void chooseFiles()}
                style={[styles.composerAttach, nightMode && darkStyles.outline]}
              >
                <Text style={styles.composerAttachText}>＋</Text>
                {files.length > 0 && (
                  <View style={styles.composerAttachBadge}>
                    <Text style={styles.composerAttachBadgeText}>
                      {files.length}
                    </Text>
                  </View>
                )}
              </Pressable>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={
                  files.length
                    ? `${files.length} file(s) selected · Add a note…`
                    : "Write a message…"
                }
                placeholderTextColor="#929A96"
                multiline
                maxLength={2000}
                style={[
                  styles.composerInput,
                  nightMode && darkStyles.input,
                  nightMode && darkStyles.primaryText,
                ]}
              />
              <Pressable
                disabled={(!draft.trim() && !files.length) || sending}
                onPress={() => void send()}
                style={[
                  styles.composerSend,
                  ((!draft.trim() && !files.length) || sending) &&
                    styles.authButtonDisabled,
                ]}
              >
                {sending ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.composerSendText}>➤</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
