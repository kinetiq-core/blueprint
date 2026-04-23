export type SpecFrontmatter = Record<string, string>;
export type SpecMeta = {
    sourceId: string;
    sourceSlug: string;
    sourceLabel: string;
    sourceRoot: string;
    specPath: string;
    relPath: string;
    fullPath: string;
    url: string;
    title: string;
    frontmatter: SpecFrontmatter;
    hasSubfeatures: boolean;
    hasBacklog: boolean;
};
export type SourceHandle = {
    id: string;
    label: string;
    slug: string;
    resolvedRoot: string;
    originRoot: string;
};
export declare function sourceIdToSlug(id: string): string;
export declare function specUrlFor(sourceSlug: string, relPath: string): string;
export declare function loadSpec(source: SourceHandle, file: {
    fullPath: string;
    relPath: string;
    specPath: string;
}): SpecMeta;
export type SpecIndex = {
    byAbsolutePath: Map<string, SpecMeta>;
    sources: SourceHandle[];
};
export declare function buildSpecIndex(specs: SpecMeta[], sources: SourceHandle[]): SpecIndex;
export type RenderedSpec = {
    html: string;
    title: string;
    headings: Array<{
        level: number;
        text: string;
        slug: string;
    }>;
    warnings: string[];
};
export declare function renderSpec(spec: SpecMeta, index: SpecIndex): RenderedSpec;
export declare function isAbsolutePath(p: string): boolean;
export declare const PATH_SEP: "/" | "\\";
