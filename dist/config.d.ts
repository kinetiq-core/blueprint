export type BlueprintSource = {
    id: string;
    label: string;
    root: string;
};
export type BlueprintConfig = {
    sources: BlueprintSource[];
    paths: {
        mirror: string;
        generated: string;
        output: string;
    };
};
export declare function loadConfig(flags: Record<string, string | boolean>): {
    config: BlueprintConfig;
    cwd: string;
    configPath: string;
};
