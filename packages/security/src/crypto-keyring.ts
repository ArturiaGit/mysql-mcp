import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class CryptoKeyring {
  private readonly keys = new Map<string, Buffer>();

  constructor(private readonly activeKeyId: string, keys: Readonly<Record<string, string>>) {
    for (const [id, key] of Object.entries(keys)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('Invalid metadata key configuration');
      this.keys.set(id, Buffer.from(key, 'hex'));
    }
    if (!this.keys.has(activeKeyId)) throw new Error('Missing active metadata key');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(this.activeKeyId), iv);
    const content = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', this.activeKeyId, iv.toString('hex'), content.toString('hex'), cipher.getAuthTag().toString('hex')].join(':');
  }

  decrypt(payload: string): string {
    const [version, id, iv, content, tag, extra] = payload.split(':');
    if (version !== 'v1' || !id || !iv || !content || !tag || extra !== undefined ||
        !/^[a-f0-9]{24}$/.test(iv) || !/^(?:[a-f0-9]{2})+$/.test(content) || !/^[a-f0-9]{32}$/.test(tag)) {
      throw new Error('Invalid metadata ciphertext');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.getKey(id), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(content, 'hex')), decipher.final()]).toString('utf8');
  }

  private getKey(id: string): Buffer {
    const key = this.keys.get(id);
    if (!key) throw new Error('Missing metadata key');
    return key;
  }
}
