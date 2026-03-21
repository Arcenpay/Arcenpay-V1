declare module '@reclaimprotocol/js-sdk' {
  export function verifyProof(proof: unknown): Promise<boolean>;
  export class ReclaimProofRequest {
    constructor(appId: string, appSecret: string, providerId: string);
    setAppCallbackUrl(url: string): Promise<void>;
    getRequestUrl(): Promise<string>;
    getSessionId(): string | undefined;
  }
  export class ReclaimClient {
    constructor(appId: string, appSecret: string);
    getAppCallbackUrl(): string;
    getStatusUrl(sessionId: string): string;
    buildHttpProviderV2ByID(providerId: string): unknown;
    createVerificationRequest(providers: unknown[]): {
      requestUrl: string;
      sessionId: string;
      startSession(options: {
        onSuccessCallback?: (proof: unknown) => void;
        onFailedCallback?: (error: unknown) => void;
      }): Promise<void>;
    };
  }
}
