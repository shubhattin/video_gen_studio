import { RegenerateNotice } from "#/components/studio/revisions/regenerate-notice";

/** Regenerate-plan confirmation note: revise instead, or "+" for a new plan. */
export function PlanRegenerateNotice({
	revisionCount,
}: {
	revisionCount: number;
}) {
	return (
		<RegenerateNotice
			revisionCount={revisionCount}
			reviseLabel="Revise plan"
			freshStart={
				<>
					To try a different direction while keeping this plan, create a new
					plan with the <strong>+</strong> button next to the plan tabs.
				</>
			}
		/>
	);
}
