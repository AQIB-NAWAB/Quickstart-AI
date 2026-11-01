import { AppError, ErrorCode } from "@quickstart/errors";
import { encrypt, decrypt } from "../lib/encrypt.js";
import type { SecretsRepository, SecretSummaryRow } from "../repository/secrets.repository.js";

const MAX_NAME_LENGTH = 128;
const MAX_VALUE_BYTES = 8192; // 8 KB — ample for any API key

export type SecretCreateInput = {
  name: string;
  value: string;
};

export class SecretsService {
  constructor(
    private readonly repo: SecretsRepository,
    private readonly encryptionKey: string,
    private readonly keyVersion: number,
  ) {}

  async listNames(workspaceId: string): Promise<SecretSummaryRow[]> {
    return this.repo.listNames(workspaceId);
  }

  async create(
    workspaceId: string,
    input: SecretCreateInput,
    audit?: { actorUserId: string; requestId: string; serviceActor?: boolean },
  ): Promise<SecretSummaryRow> {
    this.validateName(input.name);
    this.validateValue(input.value);
    const ciphertext = encrypt(input.value, this.encryptionKey);
    return this.repo.upsert({
      workspaceId,
      name: input.name,
      ciphertext,
      keyVersion: this.keyVersion,
      audit,
    });
  }

  /**
   * Rotate: decrypt with the current key, re-encrypt with the new key.
   * Call this after bumping ENCRYPTION_KEY + ENCRYPTION_KEY_VERSION in env.
   */
  async rotate(
    workspaceId: string,
    name: string,
    newEncryptionKey: string,
    newKeyVersion: number,
    audit?: { actorUserId: string; requestId: string; serviceActor?: boolean },
  ): Promise<SecretSummaryRow> {
    const row = await this.repo.getByName(workspaceId, name);
    if (!row) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: `Secret '${name}' not found` });
    }
    const plaintext = decrypt(row.ciphertext, this.encryptionKey);
    const newCiphertext = encrypt(plaintext, newEncryptionKey);
    const rotated = await this.repo.rotate({
      workspaceId,
      name,
      newCiphertext,
      newKeyVersion,
      audit,
    });
    if (!rotated) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: `Secret '${name}' disappeared during rotation`,
      });
    }
    return rotated;
  }

  /**
   * Internal-only: returns the decrypted plaintext value.
   * Never call this from a public HTTP handler.
   */
  async revealValue(workspaceId: string, name: string): Promise<string> {
    const row = await this.repo.getByName(workspaceId, name);
    if (!row) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: `Secret '${name}' not found` });
    }
    return decrypt(row.ciphertext, this.encryptionKey);
  }

  async delete(
    workspaceId: string,
    name: string,
    audit?: { actorUserId: string; requestId: string; serviceActor?: boolean },
  ): Promise<void> {
    const deleted = await this.repo.deleteByName(workspaceId, name, audit);
    if (!deleted) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: `Secret '${name}' not found` });
    }
  }

  private validateName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Secret name must not be empty",
      });
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Secret name must not exceed ${MAX_NAME_LENGTH} characters`,
      });
    }
    if (!/^[\w.\-/]+$/.test(name)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          "Secret name may only contain letters, digits, underscores, dots, hyphens, and slashes",
      });
    }
  }

  private validateValue(value: string): void {
    if (!value || value.length === 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Secret value must not be empty",
      });
    }
    if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Secret value must not exceed ${MAX_VALUE_BYTES} bytes`,
      });
    }
  }
}
