import { useEffect, useRef } from "react";
import { Animated, Pressable, Text } from "react-native";
import { styles } from "../theme";

export function ThemeToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(position, {
      toValue: value ? 1 : 0,
      useNativeDriver: true,
      damping: 15,
      stiffness: 190,
      mass: 0.55,
    }).start();
  }, [position, value]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel="Night mode"
      onPress={() => onChange(!value)}
      style={[styles.themeToggle, value && styles.themeToggleActive]}
    >
      <Text style={styles.themeSun}>☀</Text>
      <Text style={styles.themeMoon}>☾</Text>
      <Animated.View
        style={[
          styles.themeKnob,
          {
            transform: [
              {
                translateX: position.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 28],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={styles.themeKnobIcon}>{value ? "☾" : "☀"}</Text>
      </Animated.View>
    </Pressable>
  );
}
