import { ConvexProviderWithAuth } from "convex/react";
import type { ReactNode } from "react";
import { AuthGate } from "#/components/auth-gate";
import { Toaster } from "#/components/ui/toast";
import { useConvexBetterAuth } from "#/hooks/use-convex-auth";
import { ThemeProvider } from "#/hooks/use-theme";
import { convex } from "#/lib/convex";

export function AppProviders({ children }: { children: ReactNode }) {
	return (
		<ConvexProviderWithAuth client={convex} useAuth={useConvexBetterAuth}>
			<ThemeProvider>
				<Toaster>
					<AuthGate>{children}</AuthGate>
				</Toaster>
			</ThemeProvider>
		</ConvexProviderWithAuth>
	);
}
