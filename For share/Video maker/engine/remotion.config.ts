/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 *
 * Tailwind убран 06.08.2026 (дефект I5): в шаблонах он не использовался ни
 * одним классом, а @remotion/tailwind-v4 тянул за собой ещё один пакет,
 * который обязан совпадать по версии со всем остальным Remotion.
 */

import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
