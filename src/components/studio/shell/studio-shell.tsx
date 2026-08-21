import { api } from "@convex/_generated/api";
import { Link } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { FileText, Images, Sparkles } from "lucide-react";
import { Activity, type CSSProperties, type ReactNode } from "react";
import { AccountPopover } from "#/components/studio/shell/account-popover";
import {
	HistoryPanelSkeleton,
	StudioRunSkeleton,
} from "#/components/studio/shell/studio-run-skeleton";
import { ThemeToggle } from "#/components/studio/shell/theme-toggle";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
} from "#/components/ui/sidebar";
import { TooltipProvider } from "#/components/ui/tooltip";

const emptyStudioSearch = {} as const;

type StudioShellProps = {
	children: ReactNode;
	history: ReactNode;
	activePath?: "/" | "/studio" | "/gallery" | "/prompt-templates";
	/** Override the page title shown in the top bar (else derived from activePath). */
	title?: string;
	/** Override the page subtitle shown in the top bar (else derived from activePath). */
	subtitle?: string;
};

export function StudioShell({
	children,
	history,
	activePath = "/",
	title,
	subtitle,
}: StudioShellProps) {
	const { isAuthenticated } = useConvexAuth();
	const historyRuns = useQuery(
		api.studio.queries.listRecentActivity,
		isAuthenticated ? { limit: 24 } : "skip",
	);
	const waitingForStudioData = isAuthenticated
		? historyRuns === undefined
		: false;
	const mainLabel = "Loading your runs";

	return (
		<TooltipProvider>
			<SidebarProvider
				defaultOpen
				style={
					{
						"--sidebar-width": "20rem",
						"--sidebar-width-mobile": "20rem",
					} as CSSProperties
				}
			>
				<Sidebar collapsible="icon" variant="sidebar">
					<SidebarHeader className="gap-3">
						<div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center">
							<div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
								<span className="truncate font-heading text-sm font-semibold tracking-tight text-sidebar-foreground">
									Shloka Video Studio
								</span>
							</div>
						</div>

						<SidebarGroup className="p-0">
							<SidebarGroupLabel className="group-data-[collapsible=icon]:sr-only">
								Navigation
							</SidebarGroupLabel>
							<SidebarGroupContent>
								<SidebarMenu>
									<SidebarMenuItem>
										<SidebarMenuButton
											isActive={activePath === "/"}
											tooltip="Start a new run"
											render={<Link to="/" search={emptyStudioSearch} />}
										>
											<Sparkles />
											<span>New</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
									<SidebarMenuItem>
										<SidebarMenuButton
											isActive={activePath === "/gallery"}
											tooltip="Gallery"
											render={<Link to="/gallery" />}
										>
											<Images />
											<span>Gallery</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
									<SidebarMenuItem>
										<SidebarMenuButton
											isActive={activePath === "/prompt-templates"}
											tooltip="Prompt templates"
											render={<Link to="/prompt-templates" />}
										>
											<FileText />
											<span>Prompt Templates</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarHeader>

					<SidebarSeparator className="mx-0" />

					<SidebarContent>
						<SidebarGroup className="group-data-[collapsible=icon]:hidden">
							<SidebarGroupLabel>History</SidebarGroupLabel>
							<SidebarGroupContent>
								{waitingForStudioData ? <HistoryPanelSkeleton /> : history}
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>

					<SidebarFooter>
						<div className="flex items-center justify-end group-data-[collapsible=icon]:justify-center">
							<ThemeToggle compact />
						</div>
						<SidebarMenu>
							<SidebarMenuItem>
								<AccountPopover />
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarFooter>
					<SidebarRail />
				</Sidebar>

				<SidebarInset>
					<header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border/80 bg-background/95 px-4 backdrop-blur-sm sm:px-6">
						<SidebarTrigger />
						<div className="min-w-0">
							<p className="truncate font-heading text-base font-semibold tracking-tight sm:text-lg">
								{title ??
									(activePath === "/studio"
										? "Model Studio"
										: activePath === "/gallery"
											? "Gallery"
											: activePath === "/prompt-templates"
												? "System Prompt Templates"
												: "New")}
							</p>
							<p className="truncate text-xs text-muted-foreground sm:text-sm">
								{waitingForStudioData
									? mainLabel
									: (subtitle ??
										(activePath === "/studio"
											? "Direct video model API access"
											: activePath === "/gallery"
												? "Browse and download generated clips and reference stills"
												: activePath === "/prompt-templates"
													? "Manage the prompts the planner uses for Shloka plans"
													: "Pick a studio and start a new run"))}
							</p>
						</div>
					</header>
					<div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
						<Activity mode={waitingForStudioData ? "hidden" : "visible"}>
							{children}
						</Activity>
						{waitingForStudioData ? (
							<StudioRunSkeleton label={mainLabel} />
						) : null}
					</div>
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
