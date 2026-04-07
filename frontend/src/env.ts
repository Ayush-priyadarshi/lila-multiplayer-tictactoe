export const env = {
  nakamaHost: import.meta.env.DEV ? window.location.hostname : (import.meta.env.VITE_NAKAMA_HOST ?? "127.0.0.1"),
  nakamaPort: import.meta.env.DEV ? window.location.port : (import.meta.env.VITE_NAKAMA_PORT ?? "7350"),
  nakamaScheme: import.meta.env.DEV ? window.location.protocol.replace(":", "") : (import.meta.env.VITE_NAKAMA_SCHEME ?? "http"),
  nakamaServerKey: import.meta.env.VITE_NAKAMA_SERVER_KEY ?? "defaultkey"
};
