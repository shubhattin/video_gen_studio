import { ConvexProvider } from "convex/react";
import type { ReactNode } from "react";
import { convex } from "#/lib/convex";
import { ThemeProvider } from "#/hooks/use-theme";

export function AppProviders({ children }: { children: ReactNode }) {
	return (
		<ConvexProvider client={convex}>
			<ThemeProvider>{children}</ThemeProvider>
		</ConvexProvider>
	);
}
