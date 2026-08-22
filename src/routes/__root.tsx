import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	QueryClient,
	QueryClientProvider,
	useQueryClient,
} from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useState } from "react";

import { AppProviders } from "#/components/providers";
import { themeBootScript } from "#/hooks/use-theme";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{ title: "Shloka Video Studio" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
	component: RootComponent,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
				<script>{themeBootScript}</script>
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}

function StudioDevtools() {
	const queryClient = useQueryClient();

	return (
		<TanStackDevtools
			config={{ position: "bottom-right" }}
			plugins={[
				{
					name: "Tanstack Router",
					render: <TanStackRouterDevtoolsPanel />,
				},
				{
					name: "Tanstack Query",
					render: (
						<ReactQueryDevtoolsPanel
							client={queryClient}
							style={{ height: "100%" }}
						/>
					),
				},
			]}
		/>
	);
}

function RootComponent() {
	// SPA-style client cache: created once per session, no SSR hydration.
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						refetchOnWindowFocus: false,
					},
				},
			}),
	);

	return (
		<QueryClientProvider client={queryClient}>
			<AppProviders>
				<Outlet />
				<StudioDevtools />
			</AppProviders>
		</QueryClientProvider>
	);
}
