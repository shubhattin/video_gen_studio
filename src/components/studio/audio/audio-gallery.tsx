import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
	AUDIO_TAKE_SKELETON_KEYS,
	AudioTakeCard,
	AudioTakeCardSkeleton,
	type AudioTakeItem,
} from "#/components/studio/audio/audio-take-card";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import {
	useSignedMediaUrls,
	withSignedUrl,
} from "#/hooks/use-signed-media-urls";
import { notifyStudioError } from "#/lib/studio-toast";

type SortOrder = "latest" | "oldest";

type AudioConnection = {
	runId: string;
	mode: "direct" | "guided";
	title?: string;
	status: string;
};

function connectionLabel(connection: AudioConnection) {
	const typeLabel = connection.mode === "guided" ? "Song run" : "Audio run";
	return connection.title?.trim()
		? `${connection.title} · ${typeLabel}`
		: `${typeLabel} (${connection.runId.slice(0, 8)}…)`;
}

/** Run connection row for the take details popover (loaded lazily). */
function ConnectionDetails({ audioId }: { audioId: string }) {
	const connection = useQuery(api.audio.queries.getGalleryAudioRunConnection, {
		audioId: audioId as Id<"galleryAudios">,
	});
	return (
		<div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
			<span className="text-xs text-muted-foreground">Connection</span>
			{connection === undefined ? (
				<p className="text-xs text-muted-foreground">Checking…</p>
			) : connection ? (
				<Link
					to="/audio"
					search={{ run: connection.runId }}
					className="truncate text-xs text-foreground underline underline-offset-3"
				>
					{connectionLabel(connection)}
				</Link>
			) : (
				<p className="text-xs text-muted-foreground">
					Abandoned — not connected to any run.
				</p>
			)}
		</div>
	);
}

export function AudioGallery() {
	const [sort, setSort] = useState<SortOrder>("latest");
	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	const deleteAudio = useMutation(api.audio.mutations.deleteGalleryAudio);

	const audios = useQuery(api.audio.queries.listGalleryAudios, { limit: 80 }) as
		| AudioTakeItem[]
		| undefined;
	const { urls, pendingKeys } = useSignedMediaUrls(
		(audios ?? []).map((audio) => audio.objectKey),
	);
	const withUrls = (audios ?? []).map((audio) => withSignedUrl(audio, urls));
	const ordered =
		sort === "oldest"
			? [...withUrls].sort((a, b) => a.createdAt - b.createdAt)
			: withUrls;

	const pendingConnection = useQuery(
		api.audio.queries.getGalleryAudioRunConnection,
		pendingDeleteId
			? { audioId: pendingDeleteId as Id<"galleryAudios"> }
			: "skip",
	);
	const canDelete =
		!deleting && pendingDeleteId != null && pendingConnection === null;

	const confirmDelete = async () => {
		if (!pendingDeleteId) return;
		setDeleting(true);
		try {
			await deleteAudio({ audioId: pendingDeleteId as Id<"galleryAudios"> });
			setPendingDeleteId(null);
		} catch (error) {
			notifyStudioError("Could not delete track", error);
		} finally {
			setDeleting(false);
		}
	};

	return (
		<section className="space-y-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
						Audio gallery
					</h1>
					<p className="text-sm text-muted-foreground">
						Shared library of generated songs and recitations. Deleting a run
						does not remove these files.
					</p>
				</div>
				{audios && audios.length > 0 ? (
					<Select
						value={sort}
						onValueChange={(value) => value && setSort(value as SortOrder)}
					>
						<SelectTrigger size="sm" aria-label="Sort tracks">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="latest">Latest</SelectItem>
							<SelectItem value="oldest">Oldest</SelectItem>
						</SelectContent>
					</Select>
				) : null}
			</div>

			{audios === undefined ? (
				<div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
					{AUDIO_TAKE_SKELETON_KEYS.map((key) => (
						<AudioTakeCardSkeleton key={key} />
					))}
				</div>
			) : audios.length === 0 ? (
				<div className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
					No audio yet. Generate a take from Sanskrit Song Studio or Audio Model
					Studio.
				</div>
			) : (
				<div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
					{ordered.map((audio) => (
						<AudioTakeCard
							key={audio.id}
							take={audio}
							urlPending={Boolean(
								audio.objectKey && pendingKeys.has(audio.objectKey),
							)}
							details={<ConnectionDetails audioId={audio.id} />}
							deleteDisabled={deleting}
							onDelete={() => setPendingDeleteId(audio.id)}
						/>
					))}
				</div>
			)}

			<AlertDialog
				open={pendingDeleteId != null}
				onOpenChange={(open) => {
					if (!open) setPendingDeleteId(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this track?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently removes the track from the shared gallery. This
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{pendingConnection ? (
						<div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/50 p-3 text-sm">
							<span className="font-medium">
								This track is connected to a run
							</span>
							<span className="truncate text-xs text-muted-foreground">
								{connectionLabel(pendingConnection)}
							</span>
							<p className="text-xs text-muted-foreground">
								Tracks that are part of a run cannot be deleted here. Delete the
								run in the history sidebar first.
							</p>
						</div>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={!canDelete}
							onClick={() => void confirmDelete()}
						>
							{deleting ? "Deleting…" : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
