import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useTheme, type ThemePreference } from "#/hooks/use-theme";

const options: Array<{
	value: ThemePreference;
	label: string;
	icon: typeof Sun;
}> = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
];

export function ThemeToggle() {
	const { preference, setPreference } = useTheme();
	const active =
		options.find((option) => option.value === preference) ?? options[0];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button variant="outline" size="sm" className="min-h-11 gap-2">
						<active.icon className="size-4" />
						<span className="hidden sm:inline">{active.label}</span>
					</Button>
				}
			/>
			<DropdownMenuContent align="end">
				{options.map((option) => (
					<DropdownMenuItem
						key={option.value}
						onClick={() => setPreference(option.value)}
						className="gap-2"
					>
						<option.icon className="size-4" />
						{option.label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
