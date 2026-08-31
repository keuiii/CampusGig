import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RegistrationResponse } from "../types";
import { darkStyles, green, styles } from "../theme";
import { ThemeToggle } from "../components/ThemeToggle";

function GoogleSocialButton({
  mode,
  nightMode,
  onAuthenticate,
}: {
  mode: "login" | "register";
  nightMode: boolean;
  onAuthenticate: (
    path: string,
    values: Record<string, unknown>,
  ) => Promise<any>;
}) {
  const [busy, setBusy] = useState(false);
  async function signIn() {
    setBusy(true);
    try {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
      const result = await GoogleSignin.signIn();
      if (result.type !== "success") return;
      const idToken = result.data.idToken;
      if (!idToken)
        throw new Error("Google did not return a secure identity token.");
      await onAuthenticate("social", { provider: "GOOGLE", idToken });
    } catch (error) {
      Alert.alert(
        "Google sign-in failed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        mode === "login" ? "Continue with Google" : "Sign up with Google"
      }
      disabled={busy}
      onPress={() => void signIn()}
      style={({ pressed }) => [
        styles.socialAuthIconButton,
        nightMode && darkStyles.input,
        busy && styles.authButtonDisabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={green} />
      ) : (
        <Image
          source={require("../../assets/google-g.png")}
          style={styles.googleMark}
          resizeMode="contain"
        />
      )}
    </Pressable>
  );
}

export function AuthScreen({
  nightMode,
  onNightModeChange,
  onAuthenticate,
}: {
  nightMode: boolean;
  onNightModeChange: (value: boolean) => void;
  onAuthenticate: (
    path: string,
    values: Record<string, unknown>,
  ) => Promise<any>;
}) {
  const [mode, setMode] = useState<
    "login" | "register" | "verify" | "forgot" | "reset"
  >("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [isStudent, setIsStudent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const googleConfigured =
    Platform.OS === "android"
      ? Boolean(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID)
      : Platform.OS === "ios"
        ? Boolean(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID)
        : Boolean(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
  const [tabTrackWidth, setTabTrackWidth] = useState(0);
  const sliderX = useRef(new Animated.Value(0)).current;
  const formMotion = useRef(new Animated.Value(1)).current;
  const formReady =
    mode === "verify"
      ? code.length === 6
      : mode === "forgot"
        ? Boolean(email.trim())
        : mode === "reset"
          ? code.length === 6 && password.length >= 8
          : Boolean(
              email.trim() &&
                password.length >= 8 &&
                (mode === "login" || displayName.trim().length >= 2),
            );

  function switchMode(
    nextMode: "login" | "register" | "verify" | "forgot" | "reset",
  ) {
    if (nextMode === mode) return;
    const segmentWidth = Math.max(0, (tabTrackWidth - 8) / 2);
    Animated.timing(sliderX, {
      toValue: nextMode === "register" ? segmentWidth : 0,
      duration: 240,
      useNativeDriver: true,
    }).start();
    Animated.timing(formMotion, {
      toValue: 0,
      duration: 110,
      useNativeDriver: true,
    }).start(() => {
      setMode(nextMode);
      setPassword("");
      setCode("");
      setShowPassword(false);
      formMotion.setValue(0);
      Animated.spring(formMotion, {
        toValue: 1,
        damping: 18,
        stiffness: 190,
        mass: 0.65,
        useNativeDriver: true,
      }).start();
    });
  }

  async function submit() {
    if (!formReady)
      return Alert.alert(
        "Complete your details",
        "Please fill in every required field.",
      );
    setSubmitting(true);
    try {
      if (mode === "login")
        await onAuthenticate("login", { email: email.trim(), password });
      else if (mode === "register") {
        const result = (await onAuthenticate("register", {
          email: email.trim(),
          password,
          displayName: displayName.trim(),
          isStudent,
        })) as RegistrationResponse;
        switchMode("verify");
        if (result.developmentCode) {
          setTimeout(() => setCode(result.developmentCode!), 150);
          Alert.alert(
            "Development verification",
            "Your test code has been filled in automatically.",
          );
        }
      } else if (mode === "verify")
        await onAuthenticate("verify-email", { email: email.trim(), code });
      else if (mode === "forgot") {
        const result = await onAuthenticate("forgot-password", {
          email: email.trim(),
        });
        switchMode("reset");
        if (result.developmentCode)
          setTimeout(() => setCode(result.developmentCode), 150);
        Alert.alert(
          "Reset code requested",
          result.developmentCode
            ? "Your development code has been filled in."
            : result.message,
        );
      } else {
        const result = await onAuthenticate("reset-password", {
          email: email.trim(),
          code,
          password,
        });
        Alert.alert("Password updated", result.message);
        switchMode("login");
      }
    } catch (error) {
      Alert.alert(
        "Unable to continue",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={[styles.authSafe, nightMode && darkStyles.surface]}>
      <StatusBar style={nightMode ? "light" : "dark"} />
      <View style={[styles.authBlobOne, nightMode && darkStyles.authBlob]} />
      <View style={[styles.authBlobTwo, nightMode && darkStyles.authBlob]} />
      <View style={styles.authThemeToggle}>
        <ThemeToggle value={nightMode} onChange={onNightModeChange} />
      </View>
      <KeyboardAvoidingView
        style={styles.authKeyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.authContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.authIdentity}>
            <View style={styles.authMark}>
              <Text style={styles.authMarkText}>C</Text>
            </View>
            <Text
              style={[styles.authBrand, nightMode && darkStyles.primaryText]}
            >
              Campus<Text style={styles.brandAccent}>Gig</Text>
            </Text>
          </View>
          <View style={styles.authIntro}>
            <Text
              style={[styles.authTitle, nightMode && darkStyles.primaryText]}
            >
              {mode === "verify"
                ? "Verify your email"
                : mode === "forgot"
                  ? "Forgot password?"
                  : mode === "reset"
                    ? "Create a new password"
                    : "Welcome to CampusGig"}
            </Text>
            <Text
              style={[styles.authSubtitle, nightMode && darkStyles.mutedText]}
            >
              {mode === "verify"
                ? `Enter the code sent to ${email}.`
                : mode === "forgot"
                  ? "We’ll send a reset code to your account email."
                  : mode === "reset"
                    ? "Enter your code and choose a secure new password."
                    : "Your trusted marketplace for verified student skills and services."}
            </Text>
          </View>
          <View style={[styles.authCard, nightMode && darkStyles.card]}>
            {(mode === "login" || mode === "register") && (
              <View
                style={[styles.authTabs, nightMode && darkStyles.input]}
                onLayout={(event) =>
                  setTabTrackWidth(event.nativeEvent.layout.width)
                }
              >
                {tabTrackWidth > 0 && (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.authTabSlider,
                      nightMode && darkStyles.card,
                      {
                        width: (tabTrackWidth - 8) / 2,
                        transform: [{ translateX: sliderX }],
                      },
                    ]}
                  />
                )}
                <Pressable
                  onPress={() => switchMode("login")}
                  style={({ pressed }) => [
                    styles.authTab,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.authTabText,
                      mode === "login" && styles.authTabTextActive,
                    ]}
                  >
                    Log in
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => switchMode("register")}
                  style={({ pressed }) => [
                    styles.authTab,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.authTabText,
                      mode === "register" && styles.authTabTextActive,
                    ]}
                  >
                    Sign up
                  </Text>
                </Pressable>
              </View>
            )}
            <Animated.View
              style={{
                opacity: formMotion,
                transform: [
                  {
                    translateY: formMotion.interpolate({
                      inputRange: [0, 1],
                      outputRange: [8, 0],
                    }),
                  },
                ],
              }}
            >
              {mode === "register" && (
                <>
                  <Text style={styles.inputLabel}>FULL NAME</Text>
                  <View
                    style={[styles.inputShell, nightMode && darkStyles.input]}
                  >
                    <Text style={styles.inputGlyph}>◎</Text>
                    <TextInput
                      value={displayName}
                      onChangeText={setDisplayName}
                      placeholder="Your full name"
                      placeholderTextColor="#929A96"
                      style={[
                        styles.authInput,
                        nightMode && darkStyles.primaryText,
                      ]}
                      autoCapitalize="words"
                      returnKeyType="next"
                    />
                  </View>
                </>
              )}
              {mode !== "verify" && (
                <>
                  <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
                  <View
                    style={[styles.inputShell, nightMode && darkStyles.input]}
                  >
                    <Text style={styles.inputGlyph}>@</Text>
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      placeholder="you@example.com"
                      placeholderTextColor="#929A96"
                      style={[
                        styles.authInput,
                        nightMode && darkStyles.primaryText,
                      ]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      returnKeyType="next"
                    />
                  </View>
                </>
              )}
              {mode === "register" && (
                <Pressable
                  onPress={() => setIsStudent((value) => !value)}
                  style={({ pressed }) => [
                    styles.studentChoice,
                    nightMode && darkStyles.input,
                    isStudent && styles.studentChoiceActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.studentCheckbox,
                      isStudent && styles.studentCheckboxActive,
                    ]}
                  >
                    <Text style={styles.studentCheckboxText}>
                      {isStudent ? "✓" : ""}
                    </Text>
                  </View>
                  <View style={styles.studentChoiceCopy}>
                    <Text
                      style={[
                        styles.studentChoiceTitle,
                        nightMode && darkStyles.primaryText,
                      ]}
                    >
                      I’m currently a student
                    </Text>
                    <Text
                      style={[
                        styles.studentChoiceBody,
                        nightMode && darkStyles.mutedText,
                      ]}
                    >
                      Select for school verification and future provider access.
                    </Text>
                  </View>
                </Pressable>
              )}
              {(mode === "verify" || mode === "reset") && (
                <>
                  <Text style={styles.inputLabel}>SIX-DIGIT CODE</Text>
                  <View
                    style={[styles.inputShell, nightMode && darkStyles.input]}
                  >
                    <Text style={styles.inputGlyph}>#</Text>
                    <TextInput
                      value={code}
                      onChangeText={(value) =>
                        setCode(value.replace(/\D/g, "").slice(0, 6))
                      }
                      placeholder="000000"
                      placeholderTextColor="#929A96"
                      style={[
                        styles.authInput,
                        nightMode && darkStyles.primaryText,
                      ]}
                      keyboardType="number-pad"
                      maxLength={6}
                    />
                  </View>
                </>
              )}
              {(mode === "login" ||
                mode === "register" ||
                mode === "reset") && (
                <>
                  <Text style={styles.inputLabel}>
                    {mode === "reset" ? "NEW PASSWORD" : "PASSWORD"}
                  </Text>
                  <View
                    style={[styles.inputShell, nightMode && darkStyles.input]}
                  >
                    <Text style={styles.inputGlyph}>◇</Text>
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      placeholder="At least 8 characters"
                      placeholderTextColor="#929A96"
                      style={[
                        styles.authInput,
                        nightMode && darkStyles.primaryText,
                      ]}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      returnKeyType="done"
                      onSubmitEditing={formReady ? submit : undefined}
                    />
                    <Pressable
                      onPress={() => setShowPassword(!showPassword)}
                      hitSlop={10}
                    >
                      <Text style={styles.passwordToggle}>
                        {showPassword ? "HIDE" : "SHOW"}
                      </Text>
                    </Pressable>
                  </View>
                  <View style={styles.passwordHint}>
                    <Text
                      style={[
                        styles.hintCheck,
                        password.length >= 8 && styles.hintCheckReady,
                      ]}
                    >
                      {password.length >= 8 ? "✓" : "○"}
                    </Text>
                    <Text
                      style={[
                        styles.hintText,
                        nightMode && darkStyles.mutedText,
                      ]}
                    >
                      Minimum 8 characters
                    </Text>
                  </View>
                </>
              )}
              <Pressable
                disabled={submitting || !formReady}
                onPress={submit}
                style={({ pressed }) => [
                  styles.authButton,
                  (submitting || !formReady) && styles.authButtonDisabled,
                  pressed && styles.pressed,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Text style={styles.authButtonText}>
                      {mode === "login"
                        ? "Log in"
                        : mode === "register"
                          ? `Create ${isStudent ? "student" : "client"} account`
                          : mode === "verify"
                            ? "Verify email"
                            : mode === "forgot"
                              ? "Send reset code"
                              : "Update password"}
                    </Text>
                    <Text style={styles.authButtonArrow}>→</Text>
                  </>
                )}
              </Pressable>
              {mode === "login" && (
                <Pressable onPress={() => switchMode("forgot")}>
                  <Text style={styles.authTextLink}>Forgot password?</Text>
                </Pressable>
              )}
              {(mode === "verify" || mode === "forgot" || mode === "reset") && (
                <Pressable onPress={() => switchMode("login")}>
                  <Text style={styles.authTextLink}>← Back to login</Text>
                </Pressable>
              )}
              <View
                style={[styles.authTrust, nightMode && darkStyles.rolePill]}
              >
                <Text style={styles.authTrustIcon}>✓</Text>
                <Text
                  style={[
                    styles.authTrustText,
                    nightMode && darkStyles.mutedText,
                  ]}
                >
                  Personal email is accepted. School email is optional and
                  account details stay private.
                </Text>
              </View>
            </Animated.View>
            {(mode === "login" || mode === "register") && (
              <View style={styles.socialAuthBelow}>
                <Text
                  style={[
                    styles.socialAuthBelowText,
                    nightMode && darkStyles.mutedText,
                  ]}
                >
                  OR CONTINUE WITH
                </Text>
                {googleConfigured ? (
                  <GoogleSocialButton
                    mode={mode}
                    nightMode={nightMode}
                    onAuthenticate={onAuthenticate}
                  />
                ) : (
                  <Pressable
                    accessibilityLabel="Google sign-in unavailable"
                    disabled
                    style={[
                      styles.socialAuthIconButton,
                      nightMode && darkStyles.input,
                      styles.authButtonDisabled,
                    ]}
                  >
                    <Image
                      source={require("../../assets/google-g.png")}
                      style={styles.googleMark}
                      resizeMode="contain"
                    />
                  </Pressable>
                )}
              </View>
            )}
          </View>
          <Text style={[styles.authNote, nightMode && darkStyles.mutedText]}>
            By continuing, you agree to the CampusGig community guidelines.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
