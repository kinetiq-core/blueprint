export interface TrackingFile {
    fullPath: string;
    relPath: string;
    specPath: string;
}
export interface TrackingRow {
    [key: string]: string;
}
export interface TrackingResult {
    mobileFeatureRows: TrackingRow[];
    webFeatureRows: TrackingRow[];
    backendRows: TrackingRow[];
    releaseRows: TrackingRow[];
    opsRows: TrackingRow[];
    futureRows: TrackingRow[];
    subfeatureRows: TrackingRow[];
    backlogRows: TrackingRow[];
    mobileFeatureCsv: string;
    webFeatureCsv: string;
    backendCsv: string;
    releaseCsv: string;
    opsCsv: string;
    futureCsv: string;
    subfeatureCsv: string;
    backlogCsv: string;
}
export declare function collectSpecTracking(specFiles: TrackingFile[]): TrackingResult;
