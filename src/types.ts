export interface RuleData {
    title?: string;
    subtitle?: string;
    description?: string;
    summary?: string;
    icon?: string;
    optional?: string;
    reference?: string;
    bullets?: Bullet[];
    tags?: string[];
}

export interface Bullet {
    type: 'paragraph' | 'list' | 'table';
    content?: string;
    items?: string[];
    headers?: string[];
    rows?: (string | number | null)[][];
}

export interface RuleInfo {
    ruleData: RuleData;
    type: string;
    sectionId: string;
}

export interface SectionConfig {
    id: string;
    dataKey: string;
    type: string;
}

export interface SettingsConfig {
    id: string;
    key: string;
    stateProp: string;
    type: 'checkbox' | 'select';
}

export interface Settings {
    use2024Rules: boolean;
    showOptional: boolean;
    showHomebrew: boolean;
    reduceMotion: boolean;
    keepScreenOn: boolean;
    theme: string;
    darkMode: boolean;
    density: string;
    [key: string]: boolean | string;
}

export interface UserState {
    favorites: Set<string>;
    notes: Map<string, string>;
}

export interface UIState {
    openPopups: Map<string, HTMLDialogElement>;
    minimizedPopups: Map<string, MinimizedPopupState>;
    activeZIndex: number;
    fadeTimeout: ReturnType<typeof setTimeout> | null;
}

export interface MinimizedPopupState {
    title: string;
    top: string;
    left: string;
    zIndex: string;
}

export interface DataState {
    rulesets: Record<string, Record<string, RuleData[]>>;
    loadedRulesets: Record<string, Set<string>>;
    ruleMap: Map<string, RuleInfo>;
    ruleLinkerRegex: RegExp | null;
}

export interface AppState {
    settings: Settings;
    user: UserState;
    ui: UIState;
    data: DataState;
}

export interface PopupState {
    id: string;
    top: string;
    left: string;
    zIndex: string;
    width?: string;
    height?: string;
}

export interface ThemeManifest {
    themes: { id: string; displayName: string }[];
}
