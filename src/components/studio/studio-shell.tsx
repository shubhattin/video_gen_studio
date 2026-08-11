import { Link } from "@tanstack/react-router";
import { Clapperboard, Sparkles } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { ThemeToggle } from "#/components/studio/theme-toggle";
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
	activePath?: "/" | "/studio";
};

export function StudioShell({
	children,
	history,
	activePath = "/",
}: StudioShellProps) {
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
								<span className="truncate text-xs text-sidebar-foreground/70">
									Devotional shorts workspace
								</span>
							</div>
						</div>

						<SidebarGroup className="p-0">
							<SidebarGroupLabel className="group-data-[collapsible=icon]:sr-only">
								New run
							</SidebarGroupLabel>
							<SidebarGroupContent>
								<SidebarMenu>
									<SidebarMenuItem>
										<SidebarMenuButton
											isActive={activePath === "/"}
											tooltip="New Shloka run"
											render={<Link to="/" search={emptyStudioSearch} />}
										>
											<Sparkles />
											<span>Shloka Studio</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
									<SidebarMenuItem>
										<SidebarMenuButton
											isActive={activePath === "/studio"}
											tooltip="New Model Studio run"
											render={<Link to="/studio" search={emptyStudioSearch} />}
										>
											<Clapperboard />
											<span>Model Studio</span>
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
							<SidebarGroupContent>{history}</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>

					<SidebarFooter className="flex flex-row items-center justify-end gap-1 px-2 py-2 group-data-[collapsible=icon]:justify-center">
						<ThemeToggle compact />
					</SidebarFooter>
					<SidebarRail />
				</Sidebar>

				<SidebarInset>
					<header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border/80 bg-background/95 px-4 backdrop-blur-sm sm:px-6">
						<SidebarTrigger />
						<div className="min-w-0">
							<p className="truncate font-heading text-base font-semibold tracking-tight sm:text-lg">
								{activePath === "/studio" ? "Model Studio" : "Shloka Studio"}
							</p>
							<p className="truncate text-xs text-muted-foreground sm:text-sm">
								{activePath === "/studio"
									? "OpenRouter video models and reference stills"
									: "Plan → reference stills → OpenRouter video"}
							</p>
						</div>
					</header>
					<div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
						{children}
					</div>
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
