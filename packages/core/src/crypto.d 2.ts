export declare function initMasterKey(passphrase?: string): void;
export declare function encrypt(plaintext: string): {
    encrypted: Buffer;
    iv: Buffer;
    tag: Buffer;
};
export declare function decrypt(encrypted: Buffer, iv: Buffer, tag: Buffer): string;
export declare function storeCredential(id: string, provider: string, value: string): void;
export declare function retrieveCredential(id: string): string | null;
export declare function timingSafeEqual(a: string, b: string): boolean;
//# sourceMappingURL=crypto.d.ts.map