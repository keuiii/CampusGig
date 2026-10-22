export function realtimeSocketEnabled() {
  return process.env.NEXT_PUBLIC_REALTIME_MODE !== "polling";
}
