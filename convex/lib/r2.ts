import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
	GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../_generated/server";

const DEFAULT_PUT_EXPIRES_SECONDS = 15 * 60;
const DEFAULT_GET_EXPIRES_SECONDS = 60 * 60;

function normalizeSecret(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function requireEnv(name: string, value: string | undefined): string {
	const normalized = normalizeSecret(value);
	if (!normalized) {
		throw new Error(
			`${name} is not configured in the Convex deployment environment. Set it with: bunx convex env set ${name}`,
		);
	}
	return normalized;
}

function getR2Config() {
	const accountId = requireEnv(
		"CLOUDFLARE_ACCOUNT_ID",
		env.CLOUDFLARE_ACCOUNT_ID,
	);
	const accessKeyId = requireEnv("R2_ACCESS_KEY_ID", env.R2_ACCESS_KEY_ID);
	const secretAccessKey = requireEnv(
		"R2_SECRET_ACCESS_KEY",
		env.R2_SECRET_ACCESS_KEY,
	);
	const bucket = requireEnv("R2_BUCKET_NAME", env.R2_BUCKET_NAME);
	return {
		accountId,
		accessKeyId,
		secretAccessKey,
		bucket,
		endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
	};
}

let cachedClient: S3Client | null = null;
let cachedClientKey: string | null = null;

export function getR2Client() {
	const config = getR2Config();
	const clientKey = `${config.endpoint}:${config.accessKeyId}:${config.bucket}`;
	if (cachedClient && cachedClientKey === clientKey) {
		return { client: cachedClient, bucket: config.bucket, config };
	}
	cachedClient = new S3Client({
		region: "auto",
		endpoint: config.endpoint,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
		// Avoid x-amz-checksum-mode on presigned GETs — browsers can't satisfy it and
		// R2/S3 often omit CORS headers on the resulting error responses.
		requestChecksumCalculation: "WHEN_REQUIRED",
		responseChecksumValidation: "WHEN_REQUIRED",
	});
	cachedClientKey = clientKey;
	return { client: cachedClient, bucket: config.bucket, config };
}

export function getR2ApiOrigin() {
	return getR2Config().endpoint;
}

function randomId() {
	return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function extensionForMime(mimeType: string) {
	const normalized = mimeType.toLowerCase();
	if (normalized === "image/png") return "png";
	if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
	if (normalized === "image/webp") return "webp";
	if (normalized === "image/gif") return "gif";
	if (normalized.includes("webm")) return "webm";
	if (normalized.includes("quicktime")) return "mov";
	if (normalized.includes("mp4")) return "mp4";
	return "bin";
}

export function buildStudioObjectKey(args: {
	runId: string;
	kind: "refs" | "videos" | "frames";
	mimeType: string;
	mediaId?: string;
}) {
	const id = args.mediaId ?? randomId();
	const ext = extensionForMime(args.mimeType);
	return `studio/runs/${args.runId}/${args.kind}/${id}.${ext}`;
}

export async function putObjectBytes(args: {
	objectKey: string;
	bytes: Uint8Array;
	mimeType: string;
}) {
	const { client, bucket } = getR2Client();
	const body = Uint8Array.from(args.bytes);
	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: args.objectKey,
			Body: body,
			ContentType: args.mimeType,
			ContentLength: body.byteLength,
		}),
	);
	return args.objectKey;
}

export async function headObject(objectKey: string) {
	const { client, bucket } = getR2Client();
	const result = await client.send(
		new HeadObjectCommand({
			Bucket: bucket,
			Key: objectKey,
		}),
	);
	return {
		contentType: result.ContentType ?? null,
		contentLength: result.ContentLength ?? null,
		etag: result.ETag ?? null,
	};
}

export async function deleteObject(objectKey: string) {
	const { client, bucket } = getR2Client();
	await client.send(
		new DeleteObjectCommand({
			Bucket: bucket,
			Key: objectKey,
		}),
	);
}

export async function deleteObjects(objectKeys: string[]) {
	const unique = [...new Set(objectKeys.filter(Boolean))];
	if (unique.length === 0) {
		return;
	}
	const { client, bucket } = getR2Client();
	// R2 DeleteObjects supports up to 1000 keys per request.
	for (let i = 0; i < unique.length; i += 1000) {
		const chunk = unique.slice(i, i + 1000);
		if (chunk.length === 1) {
			await deleteObject(chunk[0]!);
			continue;
		}
		await client.send(
			new DeleteObjectsCommand({
				Bucket: bucket,
				Delete: {
					Objects: chunk.map((Key) => ({ Key })),
					Quiet: true,
				},
			}),
		);
	}
}

export async function createPresignedPutUrl(args: {
	objectKey: string;
	mimeType: string;
	expiresInSeconds?: number;
}) {
	const { client, bucket } = getR2Client();
	return await getSignedUrl(
		client,
		new PutObjectCommand({
			Bucket: bucket,
			Key: args.objectKey,
			ContentType: args.mimeType,
		}),
		{ expiresIn: args.expiresInSeconds ?? DEFAULT_PUT_EXPIRES_SECONDS },
	);
}

export async function createPresignedGetUrl(args: {
	objectKey: string;
	expiresInSeconds?: number;
	filename?: string;
	contentType?: string;
}) {
	const { client, bucket } = getR2Client();
	return await getSignedUrl(
		client,
		new GetObjectCommand({
			Bucket: bucket,
			Key: args.objectKey,
			ResponseContentType: args.contentType,
			ResponseContentDisposition: args.filename
				? `attachment; filename="${args.filename.replace(/[^\w.\-]+/g, "_").slice(0, 180) || "download.bin"}"`
				: undefined,
		}),
		{ expiresIn: args.expiresInSeconds ?? DEFAULT_GET_EXPIRES_SECONDS },
	);
}
