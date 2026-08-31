import { Pressable, Text, View } from "react-native";
import { darkStyles, styles } from "../theme";
import type { Tab } from "../types";

const items: { id: Tab; icon: string; label: string }[] = [
  { id: "home", icon: "⌂", label: "Discover" },
  { id: "orders", icon: "▱", label: "Orders" },
  { id: "messages", icon: "◌", label: "Messages" },
  { id: "profile", icon: "◎", label: "Profile" },
];

export function BottomNav({
  nightMode,
  tab,
  setTab,
}: {
  nightMode: boolean;
  tab: Tab;
  setTab: (tab: Tab) => void;
}) {
  return (
    <View style={[styles.bottomNav, nightMode && darkStyles.navigation]}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => setTab(item.id)}
          style={({ pressed }) => [
            styles.navItem,
            pressed && styles.navPressed,
          ]}
        >
          <Text
            style={[
              styles.navIcon,
              nightMode && darkStyles.mutedText,
              tab === item.id && styles.navActive,
            ]}
          >
            {item.icon}
          </Text>
          <Text
            style={[
              styles.navLabel,
              nightMode && darkStyles.mutedText,
              tab === item.id && styles.navActive,
            ]}
          >
            {item.label}
          </Text>
          {tab === item.id && <View style={styles.activePip} />}
        </Pressable>
      ))}
    </View>
  );
}
