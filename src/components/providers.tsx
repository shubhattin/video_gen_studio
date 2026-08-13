import { ConvexProvider } from "convex/react";
import type { ReactNode } from "react";
import { AuthGate } from "#/components/auth-gate";
import { Toaster } from "#/components/ui/toast";
import { ThemeProvider } from "#/hooks/use-theme";
import { convex } from "#/lib/convex";

export function AppProviders({ children }: { children: ReactNode }) {
	return (
		<ConvexProvider client={convex}>
			<ThemeProvider>
				<Toaster>
					<AuthGate>{children}</AuthGate>
				</Toaster>
			</ThemeProvider>
		</ConvexProvider>
	);
}
