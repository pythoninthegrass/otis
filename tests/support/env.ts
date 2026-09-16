/**
 * Otis reads several env vars as host overrides for config, credentials, and cache paths
 * (FIREWORKS_API_KEY, LOCAL_AI_MODEL, OTIS_HOME, HF_TOKEN, ...). A developer's real shell, or a
 * stray .env file loaded by Bun's runtime, can set any of these, and any test that calls
 * loadLocalSettings or similar without pinning an explicit `env` leaks that host state into the
 * test run instead of using the fixture it expects. Strip them once before the suite runs so
 * tests are isolated from the machine they happen to run on.
 */
const HOST_OVERRIDE_ENV_VARS = [
  "FIREWORKS_API_KEY",
  "LOCAL_AI_MODEL",
  "HF_TOKEN",
  "HUGGING_FACE_HUB_TOKEN",
  "OTIS_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "APPDATA",
  "USERPROFILE",
] as const

for (const name of HOST_OVERRIDE_ENV_VARS) delete process.env[name]
