import { describe, expect, it } from "vitest";
import {
	estimateUsdPerSecondFromPricingSkus,
	resolveVideoModelSortPrice,
	videoTokensForClip,
} from "./modelCatalog";
import {
	defaultVideoParams,
	planConfigDiverges,
	validateVideoParams,
} from "./schemas";
import {
	adaptOpenRouterVideoRequest,
	estimateVideoCostUsd,
} from "./videoAdapters";

const baseParams = {
	aspectRatio: "9:16",
	generateAudio: false,
	resolution: "720p",
	prompt: "test",
};

describe("token-billed (Seedance) video pricing", () => {
	it("matches real OpenRouter bills for Seedance 2.0 Fast 720p", () => {
		expect(videoTokensForClip("720p", 4)).toBe(87_300);
		expect(videoTokensForClip("720p", 8)).toBe(173_700);
		const fourSec = estimateVideoCostUsd({
			...baseParams,
			modelId: "bytedance/seedance-2.0-fast",
			durationSeconds: 4,
		});
		const eightSec = estimateVideoCostUsd({
			...baseParams,
			modelId: "bytedance/seedance-2.0-fast",
			durationSeconds: 8,
		});
		expect(fourSec).toBeCloseTo(0.36666, 5);
		expect(eightSec).toBeCloseTo(0.72954, 5);
	});

	it("prices by resolution, including the 1080p token rate", () => {
		const cost = (resolution: string) =>
			estimateVideoCostUsd({
				...baseParams,
				modelId: "bytedance/seedance-2.0",
				resolution,
				durationSeconds: 10,
			});
		expect(cost("480p")).toBeCloseTo((854 * 480 * 241 * 7) / 1024 / 1e6, 6);
		expect(cost("720p")).toBeCloseTo((1280 * 720 * 241 * 7) / 1024 / 1e6, 6);
		expect(cost("1080p")).toBeCloseTo(
			(1920 * 1080 * 241 * 7.7) / 1024 / 1e6,
			6,
		);
	});

	it("derives a 720p $/s from live token SKUs", () => {
		expect(
			estimateUsdPerSecondFromPricingSkus({ video_tokens: "0.0000107" }),
		).toBeCloseTo(0.23112, 5);
		expect(resolveVideoModelSortPrice("bytedance/seedance-2.0")).toBeCloseTo(
			0.1512,
			4,
		);
	});
});

describe("Gemini Omni 1.2 Flash", () => {
	const omni = "google/gemini-omni-1.2-flash";
	const liveSkus = {
		duration_seconds_with_audio: "0.104256",
		duration_seconds_with_audio_4k: "0.208512",
		duration_seconds_with_audio_360p: "0.023172",
		duration_seconds_with_audio_720p: "0.069504",
	};

	it("defaults to 9:16 · 720p · 8s with audio forced on", () => {
		expect(defaultVideoParams(omni)).toEqual({
			modelId: omni,
			aspectRatio: "9:16",
			resolution: "720p",
			durationSeconds: 8,
			generateAudio: true,
		});
	});

	it("never sends generate_audio (OpenRouter rejects false)", () => {
		const { body } = adaptOpenRouterVideoRequest({
			params: { ...defaultVideoParams(omni), generateAudio: false },
			fallbackPrompt: "A temple bell swinging in morning light.",
			referenceUrls: ["https://example.com/a.png"],
		});
		expect(body).not.toHaveProperty("generate_audio");
		expect(body.input_references).toHaveLength(1);
		expect(
			validateVideoParams({ ...defaultVideoParams(omni), generateAudio: false })
				.generateAudio,
		).toBe(true);
	});

	it("estimates cost per resolution (matches a real 360p 3s bill)", () => {
		const cost = (resolution: string, durationSeconds: number) =>
			estimateVideoCostUsd({
				...baseParams,
				modelId: omni,
				resolution,
				durationSeconds,
			});
		expect(cost("360p", 3)).toBeCloseTo(0.069516, 6);
		expect(cost("720p", 10)).toBeCloseTo(0.69504, 6);
		expect(cost("4K", 5)).toBeCloseTo(1.04256, 6);
	});

	it("sorts on the live 720p with-audio SKU", () => {
		expect(estimateUsdPerSecondFromPricingSkus(liveSkus)).toBeCloseTo(
			0.069504,
			6,
		);
	});

	it("does not flag audio divergence for always-on models", () => {
		const current = { ...defaultVideoParams(omni), generateAudio: false };
		expect(
			planConfigDiverges(current, { ...current, generateAudio: true }),
		).toBe(false);
	});
});
