import path from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: {
			"@": path.resolve(rootDir, "./src"),
			"#": path.resolve(rootDir, "./src"),
		},
	},
	optimizeDeps: {
		exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
	},
	plugins: [
		devtools(),
		nitro({ rollupConfig: { external: [/^@sentry\//] } }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
		babel({ presets: [reactCompilerPreset()] }),
	],
});

export default config;
