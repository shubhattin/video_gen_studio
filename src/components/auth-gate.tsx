import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { LogOut } from "lucide-react";
import {
	type ComponentProps,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import { Button } from "#/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import { Skeleton } from "#/components/ui/skeleton";
import { Spinner } from "#/components/ui/spinner";
import { signIn, signOut, useSession } from "#/lib/auth-client";
import { notifyStudioError } from "#/lib/studio-toast";

function googleCallbackUrl() {
	return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

function GoogleMark(props: ComponentProps<"svg">) {
	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" {...props}>
			<path
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
				fill="#4285F4"
			/>
			<path
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z"
				fill="#34A853"
			/>
			<path
				d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84Z"
				fill="#FBBC05"
			/>
			<path
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z"
				fill="#EA4335"
			/>
		</svg>
	);
}

function AuthSessionPending() {
	return (
		<div
			aria-busy="true"
			aria-live="polite"
			className="flex min-h-svh flex-col items-center justify-center gap-6 p-6"
			role="status"
		>
			<Spinner className="size-6" />
			<div className="flex w-full max-w-sm flex-col gap-3">
				<Skeleton className="h-8 w-48 max-w-full" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="mt-2 h-10 w-full rounded-md" />
			</div>
			<p className="sr-only">Checking your session</p>
		</div>
	);
}

function GoogleSignIn() {
	const [pending, setPending] = useState(false);

	const onGoogleLogin = async () => {
		setPending(true);
		try {
			const { error } = await signIn.social({
				provider: "google",
				callbackURL: googleCallbackUrl(),
			});
			if (error) {
				setPending(false);
				notifyStudioError(
					"Google sign-in failed",
					error.message ??
						error.statusText ??
						"Could not start Google sign-in.",
				);
			}
		} catch (error) {
			setPending(false);
			notifyStudioError("Google sign-in failed", error);
		}
	};

	return (
		<div className="flex min-h-svh items-center justify-center p-6">
			<Empty className="max-w-sm border-none">
				<EmptyHeader>
					<EmptyTitle>Shloka Video Studio</EmptyTitle>
				</EmptyHeader>
				<EmptyContent>
					<Button
						className="min-h-11 w-full"
						disabled={pending}
						onClick={onGoogleLogin}
						size="lg"
						variant="outline"
					>
						{pending ? (
							<Spinner data-icon="inline-start" />
						) : (
							<GoogleMark data-icon="inline-start" />
						)}
						Continue with Google
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}

function AccessDenied() {
	const [pending, setPending] = useState(false);

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
		<div className="flex min-h-svh items-center justify-center p-6">
			<Empty className="max-w-sm border-none">
				<EmptyHeader>
					<EmptyTitle>Access denied</EmptyTitle>
					<EmptyDescription>
						This studio is limited to admin accounts.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button
						className="min-h-11 w-full"
						disabled={pending}
						onClick={onLogout}
						size="lg"
						variant="outline"
					>
						{pending ? (
							<Spinner data-icon="inline-start" />
						) : (
							<LogOut data-icon="inline-start" />
						)}
						Log out
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}

export function AuthGate({ children }: { children: ReactNode }) {
	const { data: session, isPending } = useSession();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	if (!mounted || isPending) {
		return <AuthSessionPending />;
	}

	if (!session) {
		return <GoogleSignIn />;
	}

	if (session.user.role !== "admin") {
		return <AccessDenied />;
	}

	return (
		<>
			<AuthLoading>
				<AuthSessionPending />
			</AuthLoading>
			<Unauthenticated>
				<ConvexTokenError />
			</Unauthenticated>
			<Authenticated>{children}</Authenticated>
		</>
	);
}

function ConvexTokenError() {
	return (
		<div className="flex min-h-svh items-center justify-center p-6">
			<Empty className="max-w-sm border-none">
				<EmptyHeader>
					<EmptyTitle>Could not connect</EmptyTitle>
					<EmptyDescription>
						The studio signed you in, but Convex rejected the access token.
						Refresh to try again.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={() => window.location.reload()} size="lg">
						Refresh
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}
