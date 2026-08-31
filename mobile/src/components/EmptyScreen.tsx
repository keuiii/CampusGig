import { Pressable, ScrollView, Text, View } from "react-native";
import { darkStyles, styles } from "../theme";

export function EmptyScreen({
  nightMode,
  eyebrow,
  title,
  icon,
  message,
  action,
  onAction,
}: {
  nightMode: boolean;
  eyebrow: string;
  title: string;
  icon: string;
  message: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <ScrollView
      style={[styles.screen, nightMode && darkStyles.surface]}
      contentContainerStyle={styles.standardContent}
    >
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={[styles.pageTitle, nightMode && darkStyles.primaryText]}>
        {title}
      </Text>
      <View style={styles.largeEmpty}>
        <View style={styles.largeEmptyIcon}>
          <Text style={styles.largeEmptyIconText}>{icon}</Text>
        </View>
        <Text style={[styles.emptyTitle, nightMode && darkStyles.primaryText]}>
          Nothing here yet
        </Text>
        <Text style={[styles.emptyBody, nightMode && darkStyles.mutedText]}>
          {message}
        </Text>
        {action && (
          <Pressable style={styles.primaryButton} onPress={onAction}>
            <Text style={styles.primaryButtonText}>{action}</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}
