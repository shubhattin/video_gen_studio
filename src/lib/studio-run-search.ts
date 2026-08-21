import { z } from "zod";

export const studioRunSearchSchema = z.object({
	run: z.string().min(1).optional().catch(undefined),
	/** Selected plan tab within a shloka run. */
	plan: z.string().min(1).optional().catch(undefined),
});

export type StudioRunSearch = z.infer<typeof studioRunSearchSchema>;
