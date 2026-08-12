import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
	env: {
		OPENROUTER_API_KEY: v.optional(v.string()),
		OPENAI_API_KEY: v.optional(v.string()),
		CLOUDFLARE_ACCOUNT_ID: v.optional(v.string()),
		R2_ACCESS_KEY_ID: v.optional(v.string()),
		R2_SECRET_ACCESS_KEY: v.optional(v.string()),
		R2_BUCKET_NAME: v.optional(v.string()),
	},
});

export default app;
