import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";

export type ThemePreference = "system" | "light" | "dark";

type ThemeContextValue = {
	preference: ThemePreference;
	resolvedTheme: "light" | "dark";
	setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "shloka-studio-theme";

function getSystemTheme(): "light" | "dark" {
	if (typeof window === "undefined") {
		return "light";
	}
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function resolveTheme(preference: ThemePreference): "light" | "dark" {
	return preference === "system" ? getSystemTheme() : preference;
}

function applyTheme(theme: "light" | "dark") {
	document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [preference, setPreferenceState] = useState<ThemePreference>(() => {
		if (typeof window === "undefined") {
			return "system";
		}
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === "light" || stored === "dark" || stored === "system") {
			return stored;
		}
		return "system";
	});

	const resolvedTheme = resolveTheme(preference);

	useEffect(() => {
		applyTheme(resolvedTheme);
	}, [resolvedTheme]);

	useEffect(() => {
		if (preference !== "system") {
			return;
		}
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyTheme(getSystemTheme());
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [preference]);

	const setPreference = (next: ThemePreference) => {
		localStorage.setItem(STORAGE_KEY, next);
		setPreferenceState(next);
	};

	return (
		<ThemeContext.Provider
			value={{ preference, resolvedTheme, setPreference }}
		>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within ThemeProvider.");
	}
	return context;
}

export const themeBootScript = `(function(){try{var k='${STORAGE_KEY}';var s=localStorage.getItem(k);var t=s==='light'||s==='dark'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;
