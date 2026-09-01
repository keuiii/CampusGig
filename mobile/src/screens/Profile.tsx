import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { API_URL, STORAGE_KEYS } from "../config";
import { darkStyles, green, styles } from "../theme";
import { ThemeToggle } from "../components/ThemeToggle";
import type {
  AuthUser,
  MfaSetup,
  MfaStatus,
  ProviderProfileData,
  School,
  StudentProfile,
  VerificationRequest,
} from "../types";

const TOKEN_KEY = STORAGE_KEYS.accessToken;

function AccountSettings({
  user,
  nightMode,
}: {
  user: AuthUser;
  nightMode: boolean;
}) {
  type PasswordChangeRequest = {
    id: string;
    status: "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "EXPIRED";
    expiresAt: string;
    createdAt?: string;
  };
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [passwordRequest, setPasswordRequest] =
    useState<PasswordChangeRequest | null>(null);
  const [cancellingPasswordRequest, setCancellingPasswordRequest] =
    useState(false);
  const canUpdatePassword = Boolean(
    currentPassword &&
      newPassword.length >= 8 &&
      newPassword === confirmPassword &&
      !saving,
  );

  async function authRequest<T>(path: string, init?: RequestInit) {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    const response = await fetch(`${API_URL}/api/v1/auth/${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    const result = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        Array.isArray(result?.message)
          ? result.message.join("\n")
          : (result?.message ?? "Unable to update security settings."),
      );
    return result as T;
  }

  async function loadMfaStatus() {
    setMfaStatus(await authRequest<MfaStatus>("mfa/status"));
  }
  useEffect(() => {
    void loadMfaStatus().catch(() => undefined);
    void authRequest<PasswordChangeRequest | null>("password-change/pending")
      .then(setPasswordRequest)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!passwordRequest || passwordRequest.status !== "PENDING") return;
    const timer = setInterval(() => {
      void authRequest<PasswordChangeRequest>(
        `password-change/${passwordRequest.id}/status`,
      )
        .then((result) => {
          if (result.status === "PENDING") return setPasswordRequest(result);
          setPasswordRequest(null);
          if (result.status === "CONFIRMED")
            Alert.alert(
              "Password changed",
              "Your email confirmation was accepted. Use the new password next time you sign in.",
            );
          else
            Alert.alert(
              "Password unchanged",
              result.status === "REJECTED"
                ? "The email confirmation was rejected."
                : "The password request is no longer valid.",
            );
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [passwordRequest?.id, passwordRequest?.status]);

  async function runMfa(action: () => Promise<void>) {
    setMfaBusy(true);
    try {
      await action();
    } catch (error) {
      Alert.alert(
        "Security update failed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setMfaBusy(false);
    }
  }

  async function changePassword() {
    if (newPassword.length < 8)
      return Alert.alert(
        "Password is too short",
        "Use at least 8 characters for your new password.",
      );
    if (newPassword !== confirmPassword)
      return Alert.alert(
        "Passwords do not match",
        "Enter the same new password in both fields.",
      );
    setSaving(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          Array.isArray(result?.message)
            ? result.message.join("\n")
            : (result?.message ?? "Unable to update your password."),
        );
      setPasswordRequest(result as PasswordChangeRequest);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      Alert.alert(
        "Could not update password",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function cancelPasswordRequest() {
    if (!passwordRequest) return;
    setCancellingPasswordRequest(true);
    try {
      await authRequest(`password-change/${passwordRequest.id}/cancel`, {
        method: "POST",
      });
      setPasswordRequest(null);
      Alert.alert(
        "Request cancelled",
        "The email confirmation link is no longer valid. Your password was not changed.",
      );
    } catch (error) {
      Alert.alert(
        "Unable to cancel",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setCancellingPasswordRequest(false);
    }
  }

  if (passwordRequest?.status === "PENDING")
    return (
      <View style={[styles.passwordWaitingCard, nightMode && darkStyles.card]}>
        <View style={styles.passwordWaitingIcon}>
          <Text style={styles.passwordWaitingIconText}>✉</Text>
        </View>
        <Text
          style={[
            styles.passwordWaitingTitle,
            nightMode && darkStyles.primaryText,
          ]}
        >
          Waiting for email confirmation
        </Text>
        <Text
          style={[
            styles.passwordWaitingBody,
            nightMode && darkStyles.mutedText,
          ]}
        >
          Open the email sent to {user.email}, review the request, then confirm
          or reject it. Your current password remains active while you wait.
        </Text>
        <View
          style={[styles.passwordWaitingStatus, nightMode && darkStyles.input]}
        >
          <ActivityIndicator color={green} size="small" />
          <Text
            style={[
              styles.passwordWaitingStatusText,
              nightMode && darkStyles.primaryText,
            ]}
          >
            Checking for your decision…
          </Text>
        </View>
        <Text
          style={[
            styles.passwordWaitingExpiry,
            nightMode && darkStyles.mutedText,
          ]}
        >
          Expires{" "}
          {new Date(passwordRequest.expiresAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </Text>
        <Pressable
          disabled={cancellingPasswordRequest}
          onPress={() => void cancelPasswordRequest()}
          style={({ pressed }) => [
            styles.passwordCancelButton,
            cancellingPasswordRequest && styles.authButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          {cancellingPasswordRequest ? (
            <ActivityIndicator color="#B54747" />
          ) : (
            <Text style={styles.passwordCancelButtonText}>
              Cancel password change
            </Text>
          )}
        </Pressable>
      </View>
    );

  return (
    <View style={[styles.expandPanel, nightMode && darkStyles.card]}>
      <Text style={[styles.formTitle, nightMode && darkStyles.primaryText]}>
        Account and security
      </Text>
      <Text style={[styles.formHelp, nightMode && darkStyles.mutedText]}>
        Your account can hold more than one role as you grow on CampusGig.
      </Text>
      <View style={[styles.accountDetail, nightMode && darkStyles.outline]}>
        <Text
          style={[styles.accountDetailLabel, nightMode && darkStyles.mutedText]}
        >
          EMAIL
        </Text>
        <Text
          style={[
            styles.accountDetailValue,
            nightMode && darkStyles.primaryText,
          ]}
        >
          {user.email}
        </Text>
      </View>
      <View style={[styles.accountDetail, nightMode && darkStyles.outline]}>
        <Text
          style={[styles.accountDetailLabel, nightMode && darkStyles.mutedText]}
        >
          ACTIVE ROLES
        </Text>
        <View style={styles.roleList}>
          {user.roles.map((role) => (
            <View
              key={role}
              style={[styles.miniRolePill, nightMode && darkStyles.rolePill]}
            >
              <Text
                style={[
                  styles.miniRoleText,
                  nightMode && darkStyles.accentText,
                ]}
              >
                {role}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <Text style={styles.panelSectionTitle}>CHANGE PASSWORD</Text>
      <Text style={styles.inputLabel}>CURRENT PASSWORD</Text>
      <View
        style={[styles.accountPasswordShell, nightMode && darkStyles.input]}
      >
        <TextInput
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry={!showCurrentPassword}
          placeholder="Enter current password"
          placeholderTextColor="#929A96"
          style={[
            styles.accountPasswordInput,
            nightMode && darkStyles.primaryText,
          ]}
        />
        <Pressable
          onPress={() => setShowCurrentPassword((value) => !value)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`${showCurrentPassword ? "Hide" : "Show"} current password`}
        >
          <Text style={styles.accountPasswordToggle}>
            {showCurrentPassword ? "HIDE" : "SHOW"}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.inputLabel}>NEW PASSWORD</Text>
      <View
        style={[styles.accountPasswordShell, nightMode && darkStyles.input]}
      >
        <TextInput
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry={!showNewPassword}
          placeholder="At least 8 characters"
          placeholderTextColor="#929A96"
          style={[
            styles.accountPasswordInput,
            nightMode && darkStyles.primaryText,
          ]}
        />
        <Pressable
          onPress={() => setShowNewPassword((value) => !value)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`${showNewPassword ? "Hide" : "Show"} new password`}
        >
          <Text style={styles.accountPasswordToggle}>
            {showNewPassword ? "HIDE" : "SHOW"}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.inputLabel}>CONFIRM NEW PASSWORD</Text>
      <View
        style={[styles.accountPasswordShell, nightMode && darkStyles.input]}
      >
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry={!showConfirmPassword}
          placeholder="Enter new password again"
          placeholderTextColor="#929A96"
          style={[
            styles.accountPasswordInput,
            nightMode && darkStyles.primaryText,
          ]}
        />
        <Pressable
          onPress={() => setShowConfirmPassword((value) => !value)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`${showConfirmPassword ? "Hide" : "Show"} password confirmation`}
        >
          <Text style={styles.accountPasswordToggle}>
            {showConfirmPassword ? "HIDE" : "SHOW"}
          </Text>
        </Pressable>
      </View>
      <Pressable
        disabled={!canUpdatePassword}
        onPress={changePassword}
        style={({ pressed }) => [
          styles.saveProfileButton,
          !canUpdatePassword && styles.authButtonDisabled,
          pressed && styles.pressed,
        ]}
      >
        {saving ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.saveProfileText}>Update password</Text>
        )}
      </Pressable>
      <View style={[styles.mobileMfaCard, nightMode && darkStyles.input]}>
        <View style={styles.mobileMfaHeading}>
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.formTitle, nightMode && darkStyles.primaryText]}
            >
              Two-factor authentication
            </Text>
            <Text style={[styles.formHelp, nightMode && darkStyles.mutedText]}>
              Protect web and mobile sign-ins with an authenticator app.
            </Text>
          </View>
          <Text style={styles.mobileMfaBadge}>
            {mfaStatus?.enabled ? "ON" : "OFF"}
          </Text>
        </View>
        {!mfaStatus?.enabled && !mfaSetup && (
          <Pressable
            disabled={mfaBusy}
            onPress={() =>
              void runMfa(async () =>
                setMfaSetup(
                  await authRequest<MfaSetup>("mfa/setup", { method: "POST" }),
                ),
              )
            }
            style={({ pressed }) => [
              styles.saveProfileButton,
              mfaBusy && styles.authButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.saveProfileText}>Set up authenticator</Text>
          </Pressable>
        )}
        {mfaSetup && !mfaStatus?.enabled && (
          <View>
            <Image
              source={{ uri: mfaSetup.qrCodeDataUrl }}
              style={styles.mobileMfaQr}
            />
            <Text style={[styles.formHelp, nightMode && darkStyles.mutedText]}>
              Scan this QR code, or enter this setup key:
            </Text>
            <Text
              selectable
              style={[
                styles.mobileMfaSecret,
                nightMode && darkStyles.primaryText,
              ]}
            >
              {mfaSetup.secret}
            </Text>
            <Text style={styles.inputLabel}>AUTHENTICATOR CODE</Text>
            <TextInput
              value={mfaCode}
              onChangeText={(value) =>
                setMfaCode(value.replace(/\D/g, "").slice(0, 6))
              }
              keyboardType="number-pad"
              placeholder="000000"
              placeholderTextColor="#929A96"
              style={[
                styles.mobileMfaInput,
                nightMode && darkStyles.input,
                nightMode && darkStyles.primaryText,
              ]}
            />
            <Pressable
              disabled={mfaBusy || mfaCode.length !== 6}
              onPress={() =>
                void runMfa(async () => {
                  const result = await authRequest<{ recoveryCodes: string[] }>(
                    "mfa/setup/confirm",
                    { method: "POST", body: JSON.stringify({ code: mfaCode }) },
                  );
                  setRecoveryCodes(result.recoveryCodes);
                  setMfaSetup(null);
                  setMfaCode("");
                  await loadMfaStatus();
                })
              }
              style={({ pressed }) => [
                styles.saveProfileButton,
                (mfaBusy || mfaCode.length !== 6) && styles.authButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.saveProfileText}>Verify and enable</Text>
            </Pressable>
          </View>
        )}
        {recoveryCodes.length > 0 && (
          <View style={styles.mobileRecoveryBox}>
            <Text
              style={[styles.formTitle, nightMode && darkStyles.primaryText]}
            >
              Save these recovery codes
            </Text>
            <Text style={[styles.formHelp, nightMode && darkStyles.mutedText]}>
              Each code works once and will not be shown again.
            </Text>
            {recoveryCodes.map((item) => (
              <Text
                selectable
                key={item}
                style={[
                  styles.mobileRecoveryCode,
                  nightMode && darkStyles.primaryText,
                ]}
              >
                {item}
              </Text>
            ))}
          </View>
        )}
        {mfaStatus?.enabled && recoveryCodes.length === 0 && (
          <View>
            <Text style={[styles.formHelp, nightMode && darkStyles.mutedText]}>
              {mfaStatus.recoveryCodesRemaining} recovery codes remain.
            </Text>
            <Text style={[styles.formHelp, nightMode && darkStyles.mutedText]}>
              {mfaStatus.trustedDeviceCount} remembered device
              {mfaStatus.trustedDeviceCount === 1 ? "" : "s"}.
            </Text>
            {mfaStatus.trustedDeviceCount > 0 && (
              <Pressable
                disabled={mfaBusy}
                onPress={() =>
                  void runMfa(async () => {
                    const result = await authRequest<{ revoked: number }>(
                      "mfa/trusted-devices/revoke",
                      { method: "POST" },
                    );
                    await AsyncStorage.removeItem(STORAGE_KEYS.trustedDevice);
                    await loadMfaStatus();
                    Alert.alert(
                      "Remembered devices removed",
                      `${result.revoked} device${result.revoked === 1 ? "" : "s"} will require a code next time.`,
                    );
                  })
                }
                style={({ pressed }) => [
                  styles.mobileMfaDanger,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.mobileMfaDangerText}>
                  Remove remembered devices
                </Text>
              </Pressable>
            )}
            <Text style={styles.inputLabel}>CURRENT AUTHENTICATOR CODE</Text>
            <TextInput
              value={mfaCode}
              onChangeText={(value) =>
                setMfaCode(value.replace(/\D/g, "").slice(0, 6))
              }
              keyboardType="number-pad"
              placeholder="000000"
              placeholderTextColor="#929A96"
              style={[
                styles.mobileMfaInput,
                nightMode && darkStyles.input,
                nightMode && darkStyles.primaryText,
              ]}
            />
            <Pressable
              disabled={mfaBusy || mfaCode.length !== 6}
              onPress={() =>
                void runMfa(async () => {
                  const result = await authRequest<{ recoveryCodes: string[] }>(
                    "mfa/recovery-codes",
                    { method: "POST", body: JSON.stringify({ code: mfaCode }) },
                  );
                  setRecoveryCodes(result.recoveryCodes);
                  setMfaCode("");
                  await loadMfaStatus();
                })
              }
              style={({ pressed }) => [
                styles.saveProfileButton,
                (mfaBusy || mfaCode.length !== 6) && styles.authButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.saveProfileText}>Replace recovery codes</Text>
            </Pressable>
            {!mfaStatus.required && (
              <Pressable
                disabled={mfaBusy || mfaCode.length !== 6 || !currentPassword}
                onPress={() =>
                  void runMfa(async () => {
                    await authRequest("mfa/disable", {
                      method: "POST",
                      body: JSON.stringify({ currentPassword, code: mfaCode }),
                    });
                    setMfaCode("");
                    setCurrentPassword("");
                    await loadMfaStatus();
                  })
                }
                style={({ pressed }) => [
                  styles.mobileMfaDanger,
                  (mfaBusy || mfaCode.length !== 6 || !currentPassword) &&
                    styles.authButtonDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.mobileMfaDangerText}>
                  Disable two-factor authentication
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function ProviderProfilePanel({ nightMode }: { nightMode: boolean }) {
  type ProviderDraft = {
    headline: string;
    bio: string;
    skills: string;
    isAvailable: boolean;
  };
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [isAvailable, setIsAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedProfile, setSavedProfile] = useState<ProviderDraft | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY)
      .then(async (token) => {
        const response = await fetch(`${API_URL}/api/v1/provider/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const value = (await response.json())
          .data as ProviderProfileData | null;
        if (value) {
          const saved = {
            headline: value.headline,
            bio: value.bio,
            skills: value.skills.join(", "),
            isAvailable: value.isAvailable,
          };
          setHeadline(saved.headline);
          setBio(saved.bio);
          setSkills(saved.skills);
          setIsAvailable(saved.isAvailable);
          setSavedProfile(saved);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  async function saveProviderProfile() {
    const skillList = [
      ...new Set(
        skills
          .split(",")
          .map((skill) => skill.trim())
          .filter(Boolean),
      ),
    ];
    if (headline.trim().length < 3)
      return Alert.alert(
        "Add a headline",
        "Use at least 3 characters to describe your service specialty.",
      );
    if (bio.trim().length < 20)
      return Alert.alert(
        "Tell clients more",
        "Your provider bio should contain at least 20 characters.",
      );
    if (!skillList.length)
      return Alert.alert(
        "Add your skills",
        "Enter at least one skill, separated by commas.",
      );
    setSaving(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/provider/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          headline: headline.trim(),
          bio: bio.trim(),
          skills: skillList,
          isAvailable,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          Array.isArray(result?.message)
            ? result.message.join("\n")
            : (result?.message ?? "Unable to save your provider profile."),
        );
      const saved = result.data as ProviderProfileData;
      const normalized = {
        headline: saved.headline,
        bio: saved.bio,
        skills: saved.skills.join(", "),
        isAvailable: saved.isAvailable,
      };
      setHeadline(normalized.headline);
      setBio(normalized.bio);
      setSkills(normalized.skills);
      setIsAvailable(normalized.isAvailable);
      setSavedProfile(normalized);
      Alert.alert(
        "Provider profile saved",
        "Your provider information is now ready for your services and dashboard.",
      );
    } catch (error) {
      Alert.alert(
        "Could not save provider profile",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const normalizedSkillText = [
    ...new Set(
      skills
        .split(",")
        .map((skill) => skill.trim())
        .filter(Boolean),
    ),
  ].join(", ");
  const providerDraft = {
    headline: headline.trim(),
    bio: bio.trim(),
    skills: normalizedSkillText,
    isAvailable,
  };
  const providerValid =
    providerDraft.headline.length >= 3 &&
    providerDraft.bio.length >= 20 &&
    Boolean(providerDraft.skills);
  const providerChanged =
    !savedProfile ||
    JSON.stringify(providerDraft) !== JSON.stringify(savedProfile);
  const canSaveProvider = providerValid && providerChanged && !saving;

  if (loading)
    return (
      <View style={[styles.expandPanel, nightMode && darkStyles.card]}>
        <ActivityIndicator color={green} />
        <Text style={[styles.panelLoading, nightMode && darkStyles.mutedText]}>
          Loading provider profile…
        </Text>
      </View>
    );
  return (
    <View
      style={[
        styles.expandPanel,
        styles.providerIdentityPanel,
        nightMode && darkStyles.card,
      ]}
    >
      <View style={styles.providerIdentityHead}>
        <View style={styles.providerIdentityIcon}>
          <Text style={styles.providerIdentityIconText}>✦</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.formTitle, nightMode && darkStyles.primaryText]}>
            Build your provider identity
          </Text>
          <Text style={[styles.formHelp, nightMode && darkStyles.mutedText]}>
            Help clients understand your strengths before viewing your services.
          </Text>
        </View>
      </View>
      <Text style={styles.inputLabel}>PROFESSIONAL HEADLINE</Text>
      <TextInput
        value={headline}
        onChangeText={setHeadline}
        maxLength={100}
        placeholder="e.g. Student graphic designer"
        placeholderTextColor="#929A96"
        style={[
          styles.profileInput,
          nightMode && darkStyles.input,
          nightMode && darkStyles.primaryText,
        ]}
      />
      <Text style={styles.inputLabel}>PROVIDER BIO</Text>
      <TextInput
        value={bio}
        onChangeText={setBio}
        multiline
        maxLength={1000}
        placeholder="Describe your experience and how you help clients"
        placeholderTextColor="#929A96"
        style={[
          styles.profileInput,
          styles.bioInput,
          nightMode && darkStyles.input,
          nightMode && darkStyles.primaryText,
        ]}
      />
      <Text style={styles.inputLabel}>SKILLS</Text>
      <TextInput
        value={skills}
        onChangeText={setSkills}
        placeholder="Logo design, Canva, Illustration"
        placeholderTextColor="#929A96"
        style={[
          styles.profileInput,
          nightMode && darkStyles.input,
          nightMode && darkStyles.primaryText,
        ]}
      />
      <Text style={[styles.fieldHint, nightMode && darkStyles.mutedText]}>
        Separate each skill with a comma.
      </Text>
      <Pressable
        onPress={() => setIsAvailable((value) => !value)}
        style={[
          styles.availabilityChoice,
          nightMode && darkStyles.input,
          isAvailable && styles.availabilityChoiceActive,
          nightMode && isAvailable && darkStyles.availabilityActive,
        ]}
      >
        <View
          style={[
            styles.studentCheckbox,
            isAvailable && styles.studentCheckboxActive,
          ]}
        >
          {isAvailable && <Text style={styles.studentCheckboxText}>✓</Text>}
        </View>
        <View style={styles.studentChoiceCopy}>
          <Text
            style={[
              styles.studentChoiceTitle,
              nightMode && darkStyles.primaryText,
            ]}
          >
            Available for new work
          </Text>
          <Text
            style={[
              styles.studentChoiceBody,
              nightMode && darkStyles.mutedText,
            ]}
          >
            Clients can see that you are currently accepting projects.
          </Text>
        </View>
      </Pressable>
      <Pressable
        disabled={!canSaveProvider}
        onPress={saveProviderProfile}
        style={({ pressed }) => [
          styles.saveProfileButton,
          !canSaveProvider && styles.authButtonDisabled,
          pressed && styles.pressed,
        ]}
      >
        {saving ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.saveProfileText}>
            {savedProfile && !providerChanged
              ? "Provider profile saved"
              : "Save provider profile"}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

export function Profile({
  nightMode,
  onNightModeChange,
  user,
  schools,
  avatarVersion,
  onAvatarChanged,
  onLogout,
}: {
  nightMode: boolean;
  onNightModeChange: (value: boolean) => void;
  user: AuthUser;
  schools: School[];
  avatarVersion: number;
  onAvatarChanged: () => void;
  onLogout: () => void;
}) {
  const initials = user.displayName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const isStudent = user.roles.includes("STUDENT");
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [schoolId, setSchoolId] = useState("");
  const [program, setProgram] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [verification, setVerification] = useState<VerificationRequest | null>(
    null,
  );
  const [studentId, setStudentId] =
    useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [submittingVerification, setSubmittingVerification] = useState(false);
  const [activePanel, setActivePanel] = useState<
    "provider" | "settings" | null
  >(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (!isStudent) return;
    AsyncStorage.getItem(TOKEN_KEY)
      .then(async (token) => {
        if (!token || !API_URL) return;
        const response = await fetch(`${API_URL}/api/v1/profile/student`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const result = await response.json();
        const value = result.data as StudentProfile | null;
        if (value) {
          setProfile(value);
          setSchoolId(value.schoolId);
          setProgram(value.program ?? "");
          setYearLevel(value.yearLevel ? String(value.yearLevel) : "");
          setBio(value.bio ?? "");
        }
        const verificationResponse = await fetch(
          `${API_URL}/api/v1/profile/student/verification`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (verificationResponse.ok)
          setVerification((await verificationResponse.json()).data ?? null);
      })
      .catch(() => undefined);
  }, [isStudent]);

  async function saveProfile() {
    if (!schoolId || !program.trim() || !yearLevel)
      return Alert.alert(
        "Complete your profile",
        "Select a school and enter your program and year level.",
      );
    setSaving(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${API_URL}/api/v1/profile/student`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          schoolId,
          program: program.trim(),
          yearLevel: Number(yearLevel),
          bio: bio.trim() || undefined,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(result?.message ?? "Unable to save your profile.");
      setProfile(result.data);
      Alert.alert(
        "Profile saved",
        "Your student information is ready for school verification.",
      );
    } catch (error) {
      Alert.alert(
        "Could not save profile",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function chooseStudentId() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "application/pdf"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!result.canceled) setStudentId(result.assets[0]);
  }

  async function submitVerification() {
    if (!profile)
      return Alert.alert(
        "Save your profile first",
        "Your school, program, and year level are required before verification.",
      );
    if (!studentId)
      return Alert.alert(
        "Select your student ID",
        "Choose a clear JPG, PNG, or PDF up to 5 MB.",
      );
    if ((studentId.size ?? 0) > 5 * 1024 * 1024)
      return Alert.alert(
        "File is too large",
        "Choose a student ID file no larger than 5 MB.",
      );
    setSubmittingVerification(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const form = new FormData();
      form.append("studentId", {
        uri: studentId.uri,
        name: studentId.name,
        type: studentId.mimeType ?? "application/octet-stream",
      } as unknown as Blob);
      const response = await fetch(
        `${API_URL}/api/v1/profile/student/verification`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          Array.isArray(result?.message)
            ? result.message.join("\n")
            : (result?.message ?? "Unable to submit verification."),
        );
      setVerification(result.data);
      setProfile({ ...profile, verificationStatus: "PENDING" });
      setStudentId(null);
      Alert.alert(
        "Submitted for review",
        "A CampusGig administrator can now review your student ID.",
      );
    } catch (error) {
      Alert.alert(
        "Submission failed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSubmittingVerification(false);
    }
  }

  async function chooseProfilePicture() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const picture = result.assets[0];
    if ((picture.size ?? 0) > 5 * 1024 * 1024)
      return Alert.alert(
        "Picture is too large",
        "Choose a JPG or PNG image no larger than 5 MB.",
      );
    setUploadingAvatar(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const form = new FormData();
      form.append("avatar", {
        uri: picture.uri,
        name: picture.name,
        type: picture.mimeType ?? "image/jpeg",
      } as unknown as Blob);
      const response = await fetch(`${API_URL}/api/v1/profile/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          Array.isArray(payload?.message)
            ? payload.message.join("\n")
            : (payload?.message ?? "Unable to upload your profile picture."),
        );
      onAvatarChanged();
      Alert.alert(
        "Profile picture updated",
        "Your new picture is now shown on your CampusGig account.",
      );
    } catch (error) {
      Alert.alert(
        "Upload failed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setUploadingAvatar(false);
    }
  }

  const profileAvatar = (
    <Pressable
      onPress={chooseProfilePicture}
      disabled={uploadingAvatar}
      style={({ pressed }) => [
        styles.profileAvatarButton,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.profileAvatar}>
        {uploadingAvatar ? (
          <ActivityIndicator color={green} />
        ) : user.hasAvatar ? (
          <Image
            source={{
              uri: `${API_URL}/api/v1/profile/avatar/${user.id}?v=${avatarVersion}`,
            }}
            style={styles.profileAvatarImage}
          />
        ) : (
          <Text style={styles.profileAvatarText}>{initials}</Text>
        )}
      </View>
      <View style={styles.avatarEditBadge}>
        <Text style={styles.avatarEditText}>＋</Text>
      </View>
    </Pressable>
  );

  const normalizedProgram = program.trim();
  const normalizedBio = bio.trim();
  const numericYearLevel = Number(yearLevel);
  const profileChanged = profile
    ? schoolId !== profile.schoolId ||
      normalizedProgram !== (profile.program ?? "") ||
      numericYearLevel !== (profile.yearLevel ?? 0) ||
      normalizedBio !== (profile.bio ?? "")
    : Boolean(schoolId || normalizedProgram || yearLevel || normalizedBio);
  const canSaveProfile = Boolean(
    schoolId &&
      normalizedProgram &&
      numericYearLevel > 0 &&
      profileChanged &&
      !saving &&
      schools.length > 0,
  );

  const appearanceSetting = (
    <View style={[styles.settingRow, nightMode && darkStyles.outline]}>
      <View style={[styles.settingIcon, nightMode && darkStyles.card]}>
        <Text style={styles.settingIconText}>◐</Text>
      </View>
      <View style={styles.settingCopy}>
        <Text
          style={[styles.settingTitle, nightMode && darkStyles.primaryText]}
        >
          Night mode
        </Text>
        <Text
          style={[styles.settingSubtitle, nightMode && darkStyles.mutedText]}
        >
          Use a darker theme for comfortable viewing
        </Text>
      </View>
      <ThemeToggle value={nightMode} onChange={onNightModeChange} />
    </View>
  );

  if (!isStudent)
    return (
      <ScrollView
        style={[styles.screen, nightMode && darkStyles.surface]}
        contentContainerStyle={styles.standardContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>YOUR CAMPUSGIG</Text>
        <Text style={[styles.pageTitle, nightMode && darkStyles.primaryText]}>
          Client profile
        </Text>
        <View style={[styles.profileCard, nightMode && darkStyles.card]}>
          {profileAvatar}
          <Text style={styles.avatarHelp}>Tap to change profile picture</Text>
          <Text
            style={[styles.profileTitle, nightMode && darkStyles.primaryText]}
          >
            {user.displayName}
          </Text>
          <Text
            style={[styles.profileSubtitle, nightMode && darkStyles.mutedText]}
          >
            {user.email}
          </Text>
          <View style={styles.rolePill}>
            <Text style={styles.rolePillText}>CLIENT</Text>
          </View>
        </View>
        <View style={[styles.clientInfoCard, nightMode && darkStyles.card]}>
          <Text style={[styles.formTitle, nightMode && darkStyles.primaryText]}>
            You’re using CampusGig as a client
          </Text>
          <Text style={[styles.formHelp, nightMode && darkStyles.mutedText]}>
            You can browse services, choose preferred schools, place orders,
            message providers, and leave reviews. This account does not claim
            student status, so student verification and provider tools are
            hidden.
          </Text>
        </View>
        <Text style={styles.groupLabel}>APPEARANCE</Text>
        {appearanceSetting}
        <Text style={styles.groupLabel}>ACCOUNT</Text>
        <Pressable
          onPress={() =>
            setActivePanel(activePanel === "settings" ? null : "settings")
          }
          style={[styles.settingRow, nightMode && darkStyles.outline]}
        >
          <View style={[styles.settingIcon, nightMode && darkStyles.card]}>
            <Text style={styles.settingIconText}>⚙</Text>
          </View>
          <View style={styles.settingCopy}>
            <Text
              style={[styles.settingTitle, nightMode && darkStyles.primaryText]}
            >
              Account settings
            </Text>
            <Text
              style={[
                styles.settingSubtitle,
                nightMode && darkStyles.mutedText,
              ]}
            >
              Roles and password security
            </Text>
          </View>
          <Text style={styles.chevron}>
            {activePanel === "settings" ? "⌃" : "›"}
          </Text>
        </Pressable>
        {activePanel === "settings" && (
          <AccountSettings user={user} nightMode={nightMode} />
        )}
        <Pressable
          onPress={onLogout}
          style={({ pressed }) => [
            styles.logoutButton,
            nightMode && darkStyles.outline,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    );

  const completion =
    profile?.verificationStatus === "APPROVED" ? 80 : profile ? 55 : 20;
  const canSubmit = Boolean(
    profile &&
      studentId &&
      !submittingVerification &&
      profile.verificationStatus !== "PENDING" &&
      profile.verificationStatus !== "APPROVED",
  );
  return (
    <ScrollView
      style={[styles.screen, nightMode && darkStyles.surface]}
      contentContainerStyle={styles.standardContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>YOUR CAMPUSGIG</Text>
      <Text style={[styles.pageTitle, nightMode && darkStyles.primaryText]}>
        Profile
      </Text>
      <View style={[styles.profileCard, nightMode && darkStyles.card]}>
        {profileAvatar}
        <Text style={styles.avatarHelp}>Tap to change profile picture</Text>
        <Text
          style={[styles.profileTitle, nightMode && darkStyles.primaryText]}
        >
          {user.displayName}
        </Text>
        <Text
          style={[styles.profileSubtitle, nightMode && darkStyles.mutedText]}
        >
          {user.email}
        </Text>
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText}>
            {profile?.verificationStatus ?? user.roles.join(" · ")}
          </Text>
        </View>
        <View style={styles.completionTrack}>
          <View style={[styles.completionFill, { width: `${completion}%` }]} />
        </View>
        <Text style={styles.completionText}>
          {completion}% profile complete
        </Text>
      </View>
      <Text style={styles.groupLabel}>APPEARANCE</Text>
      {appearanceSetting}
      <Text style={styles.groupLabel}>STUDENT INFORMATION</Text>
      <View style={[styles.profileForm, nightMode && darkStyles.card]}>
        <Text style={[styles.formTitle, nightMode && darkStyles.primaryText]}>
          Set up your campus identity
        </Text>
        <Text style={[styles.formHelp, nightMode && darkStyles.mutedText]}>
          This information connects you to the correct participating school.
        </Text>
        <Text style={styles.inputLabel}>PARTICIPATING SCHOOL</Text>
        {schools.length === 0 ? (
          <View style={styles.noSchools}>
            <Text style={styles.noSchoolsTitle}>No active schools yet</Text>
            <Text style={styles.noSchoolsBody}>
              An administrator must add and activate a real participating school
              first.
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.profileSchoolChips}
          >
            {schools.map((school) => (
              <Pressable
                key={school.id}
                onPress={() => setSchoolId(school.id)}
                style={[
                  styles.profileSchoolChip,
                  schoolId === school.id && styles.profileSchoolChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.profileSchoolChipText,
                    schoolId === school.id &&
                      styles.profileSchoolChipTextActive,
                  ]}
                >
                  {school.shortName || school.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        <Text style={styles.inputLabel}>PROGRAM / COURSE</Text>
        <TextInput
          value={program}
          onChangeText={setProgram}
          placeholder="e.g. BS Information Technology"
          placeholderTextColor="#929A96"
          style={[
            styles.profileInput,
            nightMode && darkStyles.input,
            nightMode && darkStyles.primaryText,
          ]}
        />
        <Text style={styles.inputLabel}>YEAR LEVEL</Text>
        <TextInput
          value={yearLevel}
          onChangeText={(value) => setYearLevel(value.replace(/[^0-9]/g, ""))}
          placeholder="e.g. 3"
          placeholderTextColor="#929A96"
          keyboardType="number-pad"
          maxLength={2}
          style={[
            styles.profileInput,
            nightMode && darkStyles.input,
            nightMode && darkStyles.primaryText,
          ]}
        />
        <Text style={styles.inputLabel}>SHORT BIO (OPTIONAL)</Text>
        <TextInput
          value={bio}
          onChangeText={setBio}
          placeholder="Tell the campus community about yourself"
          placeholderTextColor="#929A96"
          multiline
          maxLength={500}
          style={[
            styles.profileInput,
            styles.bioInput,
            nightMode && darkStyles.input,
            nightMode && darkStyles.primaryText,
          ]}
        />
        <Pressable
          disabled={!canSaveProfile}
          onPress={saveProfile}
          style={({ pressed }) => [
            styles.saveProfileButton,
            !canSaveProfile && styles.authButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          {saving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.saveProfileText}>
              {profile && !profileChanged
                ? "Student profile saved"
                : "Save student profile"}
            </Text>
          )}
        </Pressable>
      </View>
      <Text style={styles.groupLabel}>SCHOOL VERIFICATION</Text>
      <View style={[styles.verificationCard, nightMode && darkStyles.card]}>
        <Text style={[styles.formTitle, nightMode && darkStyles.primaryText]}>
          Verify your student identity
        </Text>
        <Text style={[styles.formHelp, nightMode && darkStyles.mutedText]}>
          Upload a clear student ID. It stays private and is available only to
          authorized CampusGig administrators.
        </Text>
        {profile?.verificationStatus === "APPROVED" ? (
          <View
            style={[
              styles.verifiedNotice,
              nightMode && darkStyles.successNotice,
            ]}
          >
            <Text
              style={[
                styles.verifiedNoticeTitle,
                nightMode && darkStyles.accentText,
              ]}
            >
              ✓ Student verified
            </Text>
            <Text
              style={[
                styles.verifiedNoticeBody,
                nightMode && darkStyles.mutedText,
              ]}
            >
              You are eligible to set up a provider profile.
            </Text>
          </View>
        ) : profile?.verificationStatus === "PENDING" ? (
          <View style={[styles.pendingNotice, nightMode && darkStyles.input]}>
            <Text style={styles.pendingNoticeTitle}>Review in progress</Text>
            <Text
              style={[
                styles.pendingNoticeBody,
                nightMode && darkStyles.mutedText,
              ]}
            >
              Submitted{" "}
              {verification
                ? new Date(verification.submittedAt).toLocaleDateString()
                : "recently"}
              . You can continue using CampusGig while waiting.
            </Text>
          </View>
        ) : (
          <>
            <Pressable
              onPress={chooseStudentId}
              style={({ pressed }) => [
                styles.filePicker,
                nightMode && darkStyles.input,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.filePickerIcon}>▤</Text>
              <View style={styles.filePickerCopy}>
                <Text
                  style={[
                    styles.filePickerTitle,
                    nightMode && darkStyles.primaryText,
                  ]}
                >
                  {studentId?.name ?? "Choose student ID"}
                </Text>
                <Text
                  style={[
                    styles.filePickerBody,
                    nightMode && darkStyles.mutedText,
                  ]}
                >
                  {studentId
                    ? `${Math.max(1, Math.round((studentId.size ?? 0) / 1024))} KB selected`
                    : "JPG, PNG, or PDF · maximum 5 MB"}
                </Text>
              </View>
              <Text style={styles.filePickerAction}>Browse</Text>
            </Pressable>
            {profile?.verificationStatus === "REJECTED" && (
              <View style={styles.rejectedNotice}>
                <Text style={styles.rejectedNoticeTitle}>
                  Previous request needs attention
                </Text>
                <Text style={styles.rejectedNoticeBody}>
                  {verification?.rejectionReason ??
                    "Please choose a clearer document and submit again."}
                </Text>
              </View>
            )}
            <Pressable
              disabled={!canSubmit}
              onPress={submitVerification}
              style={({ pressed }) => [
                styles.saveProfileButton,
                !canSubmit && styles.authButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              {submittingVerification ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.saveProfileText}>
                  Submit for verification
                </Text>
              )}
            </Pressable>
          </>
        )}
      </View>
      <Text style={styles.groupLabel}>NEXT STEPS</Text>
      <Pressable
        onPress={() =>
          user.roles.includes("PROVIDER")
            ? setActivePanel(activePanel === "provider" ? null : "provider")
            : Alert.alert(
                "Provider access is locked",
                "Complete student verification first. Once approved, CampusGig automatically adds the Provider role to your account.",
              )
        }
        style={[styles.settingRow, nightMode && darkStyles.outline]}
      >
        <View style={[styles.settingIcon, nightMode && darkStyles.card]}>
          <Text style={styles.settingIconText}>✦</Text>
        </View>
        <View style={styles.settingCopy}>
          <Text
            style={[styles.settingTitle, nightMode && darkStyles.primaryText]}
          >
            Provider profile
          </Text>
          <Text
            style={[styles.settingSubtitle, nightMode && darkStyles.mutedText]}
          >
            {user.roles.includes("PROVIDER")
              ? "Headline, bio, skills and availability"
              : "Unlocks after student verification"}
          </Text>
        </View>
        <Text style={styles.chevron}>
          {activePanel === "provider" ? "⌃" : "›"}
        </Text>
      </Pressable>
      {activePanel === "provider" && user.roles.includes("PROVIDER") && (
        <ProviderProfilePanel nightMode={nightMode} />
      )}
      <Pressable
        onPress={() =>
          setActivePanel(activePanel === "settings" ? null : "settings")
        }
        style={[styles.settingRow, nightMode && darkStyles.outline]}
      >
        <View style={[styles.settingIcon, nightMode && darkStyles.card]}>
          <Text style={styles.settingIconText}>⚙</Text>
        </View>
        <View style={styles.settingCopy}>
          <Text
            style={[styles.settingTitle, nightMode && darkStyles.primaryText]}
          >
            Account settings
          </Text>
          <Text
            style={[styles.settingSubtitle, nightMode && darkStyles.mutedText]}
          >
            Roles and password security
          </Text>
        </View>
        <Text style={styles.chevron}>
          {activePanel === "settings" ? "⌃" : "›"}
        </Text>
      </Pressable>
      {activePanel === "settings" && (
        <AccountSettings user={user} nightMode={nightMode} />
      )}
      <Pressable
        onPress={onLogout}
        style={({ pressed }) => [
          styles.logoutButton,
          nightMode && darkStyles.outline,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.logoutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
