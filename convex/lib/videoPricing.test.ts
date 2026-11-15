import { describe, expect, it } from "vitest";
import {
	estimateUsdPerSecondFromPricingSkus,
	resolveVideoModelSortPrice,
	videoTokensForClip,
} from "./modelCatalog";
import { estimateVideoCostUsd } from "./videoAdapters";

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
