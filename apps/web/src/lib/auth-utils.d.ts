/**
 * Authentication utilities using Web Crypto API
 * Compatible with Edge Runtime
 */
/**
 * Generates a random hexadecimal string of specified length
 * @param length The length of the string
 * @returns A random hexadecimal string
 */
export declare function generateRandomString(length: number): string;
/**
 * Encodes a string as UTF-8 and returns Uint8Array
 * @param str String to encode
 * @returns Uint8Array of UTF-8 encoded string
 */
export declare function encodeString(str: string): Uint8Array;
/**
 * Converts a Uint8Array to a hex string
 * @param buffer Uint8Array to convert
 * @returns Hexadecimal string representation
 */
export declare function bufferToHex(buffer: Uint8Array): string;
/**
 * Hashes a password with a salt using PBKDF2
 * @param password The password to hash
 * @param salt The salt to use (or generate a new one)
 * @returns Promise resolving to { hash: string, salt: string }
 */
export declare function hashPassword(password: string, existingSalt?: string): Promise<{
    hash: string;
    salt: string;
}>;
/**
 * Verifies a password against a stored hash and salt
 * @param password The password to verify
 * @param storedSalt The stored salt
 * @param storedHash The stored hash
 * @returns Promise resolving to boolean indicating whether password matches
 */
export declare function verifyPassword(password: string, storedSalt: string, storedHash: string): Promise<boolean>;
/**
 * Parse a stored password string in the format "salt:hash"
 * @param storedPassword The stored password string
 * @returns Object containing salt and hash
 */
export declare function parseStoredPassword(storedPassword: string): {
    salt: string;
    hash: string;
};
/**
 * Format a salt and hash into a stored password string
 * @param salt The salt
 * @param hash The hash
 * @returns Formatted string "salt:hash"
 */
export declare function formatStoredPassword(salt: string, hash: string): string;
