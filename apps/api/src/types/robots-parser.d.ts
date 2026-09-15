// The upstream robots-parser package ships a malformed index.d.ts (an empty
// ambient `declare module 'robots-parser';` followed by loose top-level
// declarations that never actually attach to that module), which makes the
// real default export untyped. This redeclares the module properly.
declare module 'robots-parser' {
  interface Robot {
    isAllowed(url: string, ua?: string): boolean | undefined;
    isDisallowed(url: string, ua?: string): boolean | undefined;
    getMatchingLineNumber(url: string, ua?: string): number;
    getCrawlDelay(ua?: string): number | undefined;
    getSitemaps(): string[];
    getPreferredHost(): string | null;
  }

  export default function robotsParser(url: string, robotstxt: string): Robot;
}
