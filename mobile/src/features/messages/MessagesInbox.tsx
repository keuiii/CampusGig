import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { API_URL } from "../../config";
import { darkStyles, green, styles } from "../../theme";
import type { ConversationInboxItem } from "../../types";

export function MessagesInbox({
  nightMode,
  conversations,
  loading,
  onRefresh,
  onOpen,
}: {
  nightMode: boolean;
  conversations: ConversationInboxItem[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpen: (conversation: ConversationInboxItem) => void;
}) {
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const filtered = conversations.filter((item) =>
    `${item.participant.displayName} ${item.latestMessage?.body ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  async function refresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }
  function preview(item: ConversationInboxItem) {
    if (!item.latestMessage) return "No messages yet — start the conversation";
    if (item.latestMessage.body)
      return `${item.latestMessage.isMine ? "You: " : ""}${item.latestMessage.body}`;
    const count = item.latestMessage.attachments?.length ?? 0;
    return `${item.latestMessage.isMine ? "You sent" : "Sent"} ${count} attachment${count === 1 ? "" : "s"}`;
  }
  return (
    <ScrollView
      style={[styles.screen, nightMode && darkStyles.surface]}
      contentContainerStyle={styles.messagesInboxContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          colors={[green]}
          tintColor={nightMode ? "#D9F36A" : green}
        />
      }
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>CONVERSATIONS</Text>
      <View style={styles.messagesTitleRow}>
        <View>
          <Text style={[styles.pageTitle, nightMode && darkStyles.primaryText]}>
            Messages
          </Text>
          <Text
            style={[
              styles.messagesInboxIntro,
              nightMode && darkStyles.mutedText,
            ]}
          >
            Keep every project conversation in one place.
          </Text>
        </View>
        <View style={styles.inboxCount}>
          <Text style={styles.inboxCountText}>
            {conversations.reduce((total, item) => total + item.unreadCount, 0)}
          </Text>
        </View>
      </View>
      <View style={[styles.inboxSearch, nightMode && darkStyles.input]}>
        <Text style={styles.inboxSearchIcon}>⌕</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search conversations"
          placeholderTextColor="#929A96"
          style={[styles.inboxSearchInput, nightMode && darkStyles.primaryText]}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")}>
            <Text style={styles.inboxSearchClear}>×</Text>
          </Pressable>
        )}
      </View>
      {loading && !conversations.length ? (
        <View style={styles.inboxLoading}>
          <ActivityIndicator color={green} />
          <Text style={[styles.emptyBody, nightMode && darkStyles.mutedText]}>
            Loading conversations…
          </Text>
        </View>
      ) : filtered.length ? (
        filtered.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => onOpen(item)}
            style={({ pressed }) => [
              styles.conversationCard,
              nightMode && darkStyles.card,
              item.unreadCount > 0 && styles.conversationUnread,
              nightMode && item.unreadCount > 0 && darkStyles.unreadCard,
              pressed && styles.pressed,
            ]}
          >
            {item.participant.hasAvatar ? (
              <Image
                source={{
                  uri: `${API_URL}/api/v1/profile/avatar/${item.participant.id}?v=${item.participant.avatarVersion}`,
                }}
                style={styles.conversationAvatar}
              />
            ) : (
              <View style={styles.conversationAvatarFallback}>
                <Text style={styles.conversationAvatarText}>
                  {item.participant.displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.conversationCopy}>
              <View style={styles.conversationTop}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.conversationName,
                    nightMode && darkStyles.primaryText,
                  ]}
                >
                  {item.participant.displayName}
                </Text>
                <Text
                  style={[
                    styles.conversationTime,
                    nightMode && darkStyles.mutedText,
                  ]}
                >
                  {new Date(item.updatedAt).toLocaleDateString() ===
                  new Date().toLocaleDateString()
                    ? new Date(item.updatedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : new Date(item.updatedAt).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}
                </Text>
              </View>
              <View style={styles.conversationBottom}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.conversationPreview,
                    nightMode && darkStyles.mutedText,
                    item.unreadCount > 0 && styles.conversationPreviewUnread,
                    nightMode && item.unreadCount > 0 && darkStyles.primaryText,
                  ]}
                >
                  {preview(item)}
                </Text>
                {item.unreadCount > 0 && (
                  <View style={styles.conversationBadge}>
                    <Text style={styles.conversationBadgeText}>
                      {item.unreadCount > 9 ? "9+" : item.unreadCount}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        ))
      ) : (
        <View style={styles.inboxEmpty}>
          <View style={styles.largeEmptyIcon}>
            <Text style={styles.largeEmptyIconText}>◌</Text>
          </View>
          <Text
            style={[styles.emptyTitle, nightMode && darkStyles.primaryText]}
          >
            {search ? "No matching conversations" : "No conversations yet"}
          </Text>
          <Text style={[styles.emptyBody, nightMode && darkStyles.mutedText]}>
            {search
              ? "Try a different name or message."
              : "Your conversations will appear here after a booking is created."}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
