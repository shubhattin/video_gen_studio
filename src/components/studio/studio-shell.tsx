import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ThemeToggle } from "#/components/studio/theme-toggle";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

type StudioShellProps = {
	children: ReactNode;
	sidebar: ReactNode;
	activePath?: "/" | "/studio";
};

export function StudioShell({
	children,
	sidebar,
	activePath = "/",
}: StudioShellProps) {
	return (
		<div className="min-h-screen bg-background text-foreground">
			<header className="sticky top-0 z-20 border-b border-border/80 bg-background/95 backdrop-blur-sm">
				<div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
					<div className="min-w-0">
						<p className="font-heading text-lg font-semibold tracking-tight text-primary sm:text-xl">
							Shloka Video Studio
						</p>
						<p className="text-xs text-muted-foreground sm:text-sm">
							Internal creative workspace for devotional shorts
						</p>
					</div>
					<ThemeToggle />
				</div>
			</header>

			<div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
				<aside className="hidden lg:block">
					<nav className="space-y-1">
						<NavItem to="/" active={activePath === "/"}>
							Shloka Studio
						</NavItem>
						<NavItem to="/studio" active={activePath === "/studio"}>
							Model Studio
						</NavItem>
					</nav>
					<div className="mt-6">{sidebar}</div>
				</aside>

				<main className="min-w-0">{children}</main>
			</div>
		</div>
	);
}

function NavItem({
	to,
	children,
	active,
}: {
	to: string;
	children: ReactNode;
	active?: boolean;
}) {
	return (
		<Button
			variant={active ? "secondary" : "ghost"}
			className={cn("w-full justify-start min-h-11", active && "font-medium")}
			nativeButton={false}
			render={<Link to={to} />}
		>
			{children}
		</Button>
	);
}
