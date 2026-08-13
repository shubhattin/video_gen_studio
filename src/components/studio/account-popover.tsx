import { ChevronsUpDown, LogOut } from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import { SidebarMenuButton } from "#/components/ui/sidebar";
import { Spinner } from "#/components/ui/spinner";
import { signOut, useSession } from "#/lib/auth-client";
import { notifyStudioError } from "#/lib/studio-toast";

function initials(name: string | undefined) {
	if (!name?.trim()) return "U";
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function AccountPopover() {
	const { data } = useSession();
	const user = data?.user;
	const [pending, setPending] = useState(false);

	if (!user) {
		return null;
	}

	const displayName = user.name?.trim() || "Account";
	const email = user.email?.trim();

	const onLogout = async () => {
		setPending(true);
		try {
			const { error } = await signOut();
			if (error) {
				setPending(false);
				notifyStudioError(
					"Could not log out",
					error.message ?? error.statusText ?? "Sign-out failed.",
				);
			}
		} catch (error) {
			setPending(false);
			notifyStudioError("Could not log out", error);
		}
	};

	return (
		<Popover>
			<PopoverTrigger
				render={<SidebarMenuButton aria-label="Account menu" size="lg" />}
			>
				<Avatar>
					{user.image ? <AvatarImage alt="Account" src={user.image} /> : null}
					<AvatarFallback>{initials(user.name)}</AvatarFallback>
				</Avatar>
				<span className="min-w-0 flex-1 truncate text-left">Account</span>
				<ChevronsUpDown className="ml-auto" />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-56 gap-3 p-3" side="top">
				<PopoverHeader>
					<div className="flex items-center gap-3">
						<Avatar>
							{user.image ? (
								<AvatarImage alt={displayName} src={user.image} />
							) : null}
							<AvatarFallback>{initials(user.name)}</AvatarFallback>
						</Avatar>
						<div className="flex min-w-0 flex-col gap-0.5">
							<PopoverTitle className="truncate">{displayName}</PopoverTitle>
							{email ? (
								<PopoverDescription className="truncate">
									{email}
								</PopoverDescription>
							) : null}
						</div>
					</div>
				</PopoverHeader>
				<Button
					className="w-full"
					disabled={pending}
					onClick={onLogout}
					variant="destructive"
				>
					{pending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<LogOut data-icon="inline-start" />
					)}
					Log out
				</Button>
			</PopoverContent>
		</Popover>
	);
}
