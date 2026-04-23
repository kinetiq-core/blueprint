export type SpecFile = {
    fullPath: string;
    relPath: string;
    specPath: string;
};
export declare function collectSpecFiles(sourceId: string, rootPath: string): SpecFile[];
